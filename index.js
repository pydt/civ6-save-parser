'use strict';

require('buffer-v6-polyfill');

// Workaround to detect buggy buffer.from support (which exists on lambda's node v4.3.2)
let useNewBuffer = false;

try {
  Buffer.from('1337', 'hex');
} catch(e) {
  useNewBuffer = true;
}

const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const util = require('util');
const zlib = require('zlib');

const START_ACTOR = new Buffer([0x58, 0xBA, 0x7F, 0x4C]);
const END_UNCOMPRESSED = new Buffer([0, 0, 1, 0]);
const COMPRESSED_DATA_END = new Buffer([0, 0, 0xFF, 0xFF]);

const GAME_DATA = {
  GAME_TURN: new Buffer([0x9D, 0x2C, 0xE6, 0xBD]),
  GAME_SPEED: new Buffer([0x99, 0xB0, 0xD9, 0x05]),
  MOD_BLOCK_1: new Buffer([0x5C, 0xAE, 0x27, 0x84]),
  MOD_BLOCK_2: new Buffer([0xC8, 0xD1, 0x8C, 0x1B]),
  MOD_BLOCK_3: new Buffer([0x44, 0x7F, 0xD4, 0xFE]),
  MOD_ID: new Buffer([0x54, 0x5F, 0xC4, 0x04]),
  MOD_TITLE: new Buffer([0x72, 0xE1, 0x34, 0x30])
};

const SLOT_HEADERS = {
  SLOT_1_HEADER: new Buffer([0xC8, 0x9B, 0x5F, 0x65]),
  SLOT_2_HEADER: new Buffer([0x5E, 0xAB ,0x58, 0x12]),
  SLOT_3_HEADER: new Buffer([0xE4, 0xFA, 0x51, 0x8B]),
  SLOT_4_HEADER: new Buffer([0x72, 0xCA, 0x56, 0xFC]),
  SLOT_5_HEADER: new Buffer([0xD1, 0x5F, 0x32 ,0x62]),
  SLOT_6_HEADER: new Buffer([0x47, 0x6F, 0x35, 0x15]),
  SLOT_7_HEADER: new Buffer([0xFD, 0x3E, 0x3C, 0x8C]),
  SLOT_8_HEADER: new Buffer([0x6B, 0x0E, 0x3B, 0xFB]),
  SLOT_9_HEADER: new Buffer([0xFA, 0x13, 0x84, 0x6B]),
  SLOT_10_HEADER: new Buffer([0x6C, 0x23, 0x83, 0x1C]),
  SLOT_11_HEADER: new Buffer([0xF4, 0x14, 0x18, 0xAA]),
  SLOT_12_HEADER: new Buffer([0x62, 0x24, 0x1F, 0xDD])
};

const ACTOR_DATA = {
  ACTOR_NAME: new Buffer([0x2F, 0x5C, 0x5E, 0x9D]),
  LEADER_NAME: new Buffer([0x5F, 0x5E, 0xCD, 0xE8]),
  ACTOR_TYPE: new Buffer([0xBE, 0xAB, 0x55, 0xCA]),
  PLAYER_NAME: new Buffer([0xFD, 0x6B, 0xB9, 0xDA]),
  PLAYER_PASSWORD: new Buffer([0x6C, 0xD1, 0x7C, 0x6E]),
  IS_CURRENT_TURN: new Buffer([0xCB, 0x21, 0xB0, 0x7A]),
  ACTOR_AI_HUMAN: new Buffer([0x95, 0xB9, 0x42, 0xCE]),  // 3 = Human, 1 = AI
  ACTOR_DESCRIPTION: new Buffer([0x65, 0x19, 0x9B, 0xFF])
};

module.exports.MARKERS = {
  START_ACTOR, END_UNCOMPRESSED, COMPRESSED_DATA_END, GAME_DATA, ACTOR_DATA
};

module.exports.parse = (buffer, options) => {
  options = options || {};

  let parsed = {
    ACTORS: [],
    CIVS: []
  };

  const chunks = [];
  let chunkStart = 0;
  let curActor;

  let state = readState(buffer);

  if (state.next4.toString() !== 'CIV6') {
    throw new Error('Not a Civilzation 6 save file. :(');
  }

  while (null !== (state = readState(buffer, state))) {
    if (state.next4.equals(GAME_DATA.GAME_SPEED)) {
      break;
    }
    state.pos++;
  }

  chunks.push(buffer.slice(chunkStart, state.pos));

  chunkStart = state.pos;

  do {
    if (state.next4.equals(END_UNCOMPRESSED)) {
      if (options.outputCompressed) {
        readCompressedData(buffer, state, path.basename(filename) + '.bin');
      }

      break;
    }

    const info = parseEntry(buffer, state);

    const tryAddActor = (key, marker) => {
      if (info.marker.equals(marker)) {
        curActor = {
          pos: state.pos,
          data: {}
        };

        curActor.data[key] = info;

        parsed.ACTORS.push(curActor);
      }
    };

    for (let key in SLOT_HEADERS) {
      tryAddActor(key, SLOT_HEADERS[key]);
    }

    if (!curActor && info.marker.equals(START_ACTOR)) {
      tryAddActor('START_ACTOR', START_ACTOR);
    } else if (info.marker.equals(ACTOR_DATA.ACTOR_DESCRIPTION)) {
      curActor = null;
    } else {
      for (let key in GAME_DATA) {
        if (info.marker.equals(GAME_DATA[key])) {
          parsed[key] = info;
        }
      }

      if (curActor) {
        for (let key in ACTOR_DATA) {
          if (info.marker.equals(ACTOR_DATA[key])) {
            curActor.data[key] = info;
          }
        }
      }
    }

    info.chunk = buffer.slice(chunkStart, state.pos); 
    chunks.push(info.chunk);

    chunkStart = state.pos;
  } while (null !== (state = readState(buffer, state)));

  chunks.push(buffer.slice(state.pos));

  for (let i = 1; i <= _.size(SLOT_HEADERS); i++) {
    const targetSlot = `SLOT_${i}_HEADER`;

    const curCiv = _.find(parsed.ACTORS, actor => {
      return actor.data[targetSlot] && 
        actor.data.ACTOR_TYPE &&
        actor.data.ACTOR_TYPE.data === 'CIVILIZATION_LEVEL_FULL_CIV';
    });

    if (curCiv) {
      parsed.CIVS.push(curCiv);
      _.pull(parsed.ACTORS, curCiv);
    }
  }

  for (let actor of _.clone(parsed.ACTORS)) {
    if (!actor.data.ACTOR_TYPE) {
      _.pull(parsed.ACTORS, actor);
    }
  }

  if (options.simple) {
    parsed = simplify(parsed);
  }

  return {
    parsed: parsed,
    chunks: chunks
  };
};

module.exports.addChunk = (chunks, afterData, marker, type, value) => {
  const newChunk = writeValue(marker, type, value);
  const chunkIndex = chunks.indexOf(afterData.chunk) + 1;
  chunks.splice(chunkIndex, 0, newChunk);
};

module.exports.modifyChunk = (chunks, parsedData, newValue) => {
  const chunkIndex = chunks.indexOf(parsedData.chunk);
  chunks[chunkIndex] = parsedData.chunk = writeValue(parsedData.marker, parsedData.type, newValue);
};

module.exports.deleteChunk = (chunks, parsedData) => {
  _.pull(chunks, parsedData.chunk);
}

if (!module.parent) {
  var argv = require('minimist')(process.argv.slice(2));
  if (!argv._.length) {
    console.log('Please pass the filename as the argument to the script.');
  } else {
    const buffer = new Buffer(fs.readFileSync(argv._[0]));
    const result = module.exports.parse(buffer, argv);
    console.log(util.inspect(result.parsed, false, null));
  }
}

// Helper functions

function writeValue(marker, type, value) {
  switch (type) {
    case 2:
      return writeInt(marker, value);

    case 0x0A:
      return writeArrayLen(marker, value);

    case 5:
      return writeString(marker, value);

    default:
      throw new Error('I don\'t know how to write type ' + type);
  }
}

function simplify(result) {
  let mapFn = _.mapValues;

  if (_.isArray(result)) {
    mapFn = _.map;
  }

  return mapFn(result, i =>{
    if (i.data && !_.isObject(i.data)) {
      return i.data;
    }

    if (i.data === false) {
      return false;
    }

    return simplify(i.data || i);
  });
}

function readState(buffer, state) {
  if (!state) {
    state = {
      pos: 0,
      next4: buffer.slice(0, 4)
    };
  } else {
    if (state.pos >= buffer.length - 4) {
      return null;
    }

    state.next4 = buffer.slice(state.pos, state.pos + 4);
  }

  return state;
}

function parseEntry(buffer, state) {
  const result = {
    pos: state.pos,
    marker: state.next4,
    type: buffer.readUInt32LE(state.pos + 4)
  };

  state.pos += 8;

  if (result.marker.readUInt32LE() < 256) {
    result.data = 'SKIP';
  } else {
    switch (result.type) {
      case 1:
        result.data = readBoolean(buffer, state);
        break;

      case 2:
      case 0x0A: // 0A is an array, but i really only care about getting the length out, which looks like a normal integer
        result.data = readInt(buffer, state);
        break;

      case 3:
        result.data = 'UNKNOWN!';
        state.pos += 12;
        break;

      case 0x15:
        result.data = 'UNKNOWN!';

        if (buffer.slice(state.pos, state.pos + 4).equals(new Buffer([0, 0, 0, 0x80]))) {
          state.pos += 20;
        } else {
          state.pos += 12;
        }
        break;

      case 4:
      case 5:
        result.data = readString(buffer, state);
        break;

      case 6:
        result.data = readUtfString(buffer, state);
        break;

      case 0x14:
        result.data = 'UNKNOWN!';
        state.pos += 16;
        break;

      case 0x0B:
        result.data = readArray(buffer, state);
        break;

      default:
        throw new Error('Error parsing: ' + JSON.stringify(result));
    }
  }

  return result;
}

function readString(buffer, state) {
  const origState = _.clone(state);
  let result = null;

  const strLen = buffer.readUInt16LE(state.pos);
  state.pos += 2;

  const strInfo = buffer.slice(state.pos, state.pos + 6);
  //new Buffer([0, 0x21, 1, 0, 0, 0]))
  if (strInfo[1] === 0 || strInfo[1] === 0x20) {
    state.pos += 10;
    result = 'Don\'t know what this kind of string is...';
  } else if (strInfo[1] === 0x21) {
    state.pos += 6;
    result = buffer.slice(state.pos, state.pos + strLen - 1).toString(); // Ignore null terminator
    state.pos += strLen;
  }

  if (result === null) {
    throw new Error('Error reading string: ' + JSON.stringify(origState));
  }

  return result;
}

function readArray(buffer, state) {
  const origState = _.clone(state);
  let result = [];

  state.pos += 8;
  const arrayLen = buffer.readUInt32LE(state.pos);
  state.pos += 4;

  for (let i = 0; i < arrayLen; i++) {
    if (buffer[state.pos] != 0x0A) {
      throw new Error('Error reading array: ' + JSON.stringify(origState));
    }

    state.pos += 16;
    const curData = {};
    result.push(curData);
    let info;

    do {
      state = readState(buffer, state);
      info = parseEntry(buffer, state);

      for (let key in GAME_DATA) {
        if (info.marker.equals(GAME_DATA[key])) {
          curData[key] = info;
        }
      }
    } while (info.data != "1");
  }

  return result;
}

function writeString(marker, newValue) {
  const strLenBuffer = new Buffer([0, 0, 0, 0x21, 1, 0, 0, 0]);
  strLenBuffer.writeUInt16LE(newValue.length + 1, 0);

  return Buffer.concat([marker, new Buffer([5, 0, 0, 0]), strLenBuffer, myBufferFrom(newValue), new Buffer([0])]);
}

function readUtfString(buffer, state) {
  const origState = _.clone(state);
  let result = null;

  const strLen = buffer.readUInt16LE(state.pos) * 2;
  state.pos += 2;

  if (buffer.slice(state.pos, state.pos + 6).equals(new Buffer([0, 0x21, 2, 0, 0, 0]))) {
    state.pos += 6;
    result = buffer.slice(state.pos, state.pos + strLen - 2).toString('ucs2'); // Ignore null terminator
    state.pos += strLen;
  }

  if (result === null) {
    throw new Error('Error reading string: ' + JSON.stringify(origState));
  }

  return result;
}

function readBoolean(buffer, state) {
  state.pos += 8;
  const result = !!buffer[state.pos];
  state.pos += 4;
  return result;
}

function readInt(buffer, state) {
  state.pos += 8;
  const result = buffer.readUInt32LE(state.pos);
  state.pos += 4;
  return result;
}

function writeInt(marker, value) {
  const valueBuffer = Buffer.alloc(4);
  valueBuffer.writeUInt32LE(value);

  return Buffer.concat([marker, new Buffer([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), valueBuffer]);
}

function writeArrayLen(marker, value) {
  const valueBuffer = Buffer.alloc(4);
  valueBuffer.writeUInt32LE(value);

  return Buffer.concat([marker, new Buffer([0x0A, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0]), valueBuffer]);
}

function readCompressedData(buffer, state, filename) {
  const compressedData = buffer.slice(state.pos + 4, buffer.indexOf(COMPRESSED_DATA_END, state.pos));
  const uncompressedData = zlib.unzipSync(compressedData);
  fs.writeFileSync(filename, uncompressedData);
}

function myBufferFrom(source) {
  if (useNewBuffer) {
    return new Buffer(source);
  }
  
  return Buffer.from(source);
}