'use strict';

require('buffer-v6-polyfill');

// Workaround to detect buggy buffer.from support (which exists on lambda's node v4.3.2)
let useNewBuffer = false;

try {
  Buffer.from('1337', 'hex');
} catch (e) {
  useNewBuffer = true;
}

const loggingEnabled = false;
const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const util = require('util');
const zlib = require('zlib');
const iconv = require('iconv-lite');
const diacritics = require('diacritics');

const START_ACTOR = new Buffer([0x58, 0xBA, 0x7F, 0x4C]);
const ZLIB_HEADER = new Buffer([0x78, 0x9C]);
const END_UNCOMPRESSED = new Buffer([0, 0, 1, 0]);
const COMPRESSED_DATA_END = new Buffer([0, 0, 0xFF, 0xFF]);

const GAME_DATA = {
  GAME_TURN: new Buffer([0x9D, 0x2C, 0xE6, 0xBD]),
  GAME_SPEED: new Buffer([0x99, 0xB0, 0xD9, 0x05]),
  MOD_BLOCK_1: new Buffer([0x5C, 0xAE, 0x27, 0x84]),
  MOD_BLOCK_2: new Buffer([0xC8, 0xD1, 0x8C, 0x1B]),
  MOD_BLOCK_3: new Buffer([0x44, 0x7F, 0xD4, 0xFE]),
  MOD_BLOCK_4: new Buffer([0xBB, 0x5E, 0x30, 0x88]),
  MOD_ID: new Buffer([0x54, 0x5F, 0xC4, 0x04]),
  MOD_TITLE: new Buffer([0x72, 0xE1, 0x34, 0x30]),
  MAP_FILE: new Buffer([0x5A, 0x87, 0xD8, 0x63]),
  MAP_SIZE: new Buffer([0x40, 0x5C, 0x83, 0x0B]),
};

const SLOT_HEADERS = [
  new Buffer([0xC8, 0x9B, 0x5F, 0x65]),
  new Buffer([0x5E, 0xAB, 0x58, 0x12]),
  new Buffer([0xE4, 0xFA, 0x51, 0x8B]),
  new Buffer([0x72, 0xCA, 0x56, 0xFC]),
  new Buffer([0xD1, 0x5F, 0x32, 0x62]),
  new Buffer([0x47, 0x6F, 0x35, 0x15]),
  new Buffer([0xFD, 0x3E, 0x3C, 0x8C]),
  new Buffer([0x6B, 0x0E, 0x3B, 0xFB]),
  new Buffer([0xFA, 0x13, 0x84, 0x6B]),
  new Buffer([0x6C, 0x23, 0x83, 0x1C]),
  new Buffer([0xF4, 0x14, 0x18, 0xAA]),
  new Buffer([0x62, 0x24, 0x1F, 0xDD]),
];

const ACTOR_DATA = {
  ACTOR_NAME: new Buffer([0x2F, 0x5C, 0x5E, 0x9D]),
  LEADER_NAME: new Buffer([0x5F, 0x5E, 0xCD, 0xE8]),
  ACTOR_TYPE: new Buffer([0xBE, 0xAB, 0x55, 0xCA]),
  PLAYER_NAME: new Buffer([0xFD, 0x6B, 0xB9, 0xDA]),
  PLAYER_PASSWORD: new Buffer([0x6C, 0xD1, 0x7C, 0x6E]),
  PLAYER_ALIVE: new Buffer([0xA6, 0xDF, 0xA7, 0x62]),
  IS_CURRENT_TURN: new Buffer([0xCB, 0x21, 0xB0, 0x7A]),
  ACTOR_AI_HUMAN: new Buffer([0x95, 0xB9, 0x42, 0xCE]), // 3 = Human, 1 = AI
  ACTOR_DESCRIPTION: new Buffer([0x65, 0x19, 0x9B, 0xFF]),
};

module.exports.MARKERS = {
  START_ACTOR,
  END_UNCOMPRESSED,
  COMPRESSED_DATA_END,
  GAME_DATA,
  ACTOR_DATA,
};

const DATA_TYPES = {
  BOOLEAN: 1,
  INTEGER: 2,
  STRING: 5,
  UTF_STRING: 6,
  ARRAY_START: 0x0A,
};

function log(message) {
  if (loggingEnabled) {
    console.log(message);
  }
}

module.exports.DATA_TYPES = DATA_TYPES;

module.exports.parse = (buffer, options) => {
  options = options || {};

  let parsed = {
    ACTORS: [],
    CIVS: [],
  };

  const chunks = [];
  let chunkStart = 0;
  let curActor;
  let compressed;

  let state = readState(buffer);

  if (state.next4.toString() !== 'CIV6') {
    throw new Error('Not a Civilization 6 save file. :(');
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
        compressed = readCompressedData(buffer, state);
      }

      break;
    }

    const info = parseEntry(buffer, state);
    log(`${chunkStart}/${chunkStart.toString(16)}: ${JSON.stringify(info)}`);

    const tryAddActor = (key, marker) => {
      if (info.marker.equals(marker)) {
        curActor = {};
        curActor[key] = info;

        parsed.ACTORS.push(curActor);
      }
    };

    for (const marker of SLOT_HEADERS) {
      tryAddActor('SLOT_HEADER', marker);
    }

    if (!curActor && info.marker.equals(START_ACTOR)) {
      tryAddActor('START_ACTOR', START_ACTOR);
    } else if (info.marker.equals(ACTOR_DATA.ACTOR_DESCRIPTION)) {
      curActor = null;
    } else {
      for (const key in GAME_DATA) {
        if (info.marker.equals(GAME_DATA[key])) {
          if (!!parsed[key]) {
            // Sometimes markers can repeat?  I really don't understand this file format...
            let suffix = 2;
            let uniqueKey;

            do {
              uniqueKey = `${key}_${suffix}`;
              suffix++;
            } while (parsed[uniqueKey]);

            parsed[uniqueKey] = info;
          } else {
            parsed[key] = info;
          }
        }
      }

      if (curActor) {
        for (const key in ACTOR_DATA) {
          if (info.marker.equals(ACTOR_DATA[key])) {
            curActor[key] = info;
          }
        }
      }
    }

    info.chunk = buffer.slice(chunkStart, state.pos);
    chunks.push(info.chunk);

    chunkStart = state.pos;
  } while (null !== (state = readState(buffer, state)));

  if (state) {
    chunks.push(buffer.slice(state.pos));
  }

  for (const curMarker of SLOT_HEADERS) {
    const curCiv = _.find(parsed.ACTORS, (actor) => {
      return actor.SLOT_HEADER &&
        actor.SLOT_HEADER.marker.equals(curMarker) &&
        actor.ACTOR_AI_HUMAN &&
        actor.ACTOR_AI_HUMAN.data !== 2 &&
        actor.ACTOR_TYPE &&
        actor.ACTOR_TYPE.data === 'CIVILIZATION_LEVEL_FULL_CIV' &&
        actor.ACTOR_NAME;
    });

    if (curCiv) {
      parsed.CIVS.push(curCiv);
      _.pull(parsed.ACTORS, curCiv);
    }
  }

  for (const actor of _.clone(parsed.ACTORS)) {
    if (!actor.ACTOR_TYPE || !actor.ACTOR_NAME) {
      _.pull(parsed.ACTORS, actor);
    }
  }

  if (options.simple) {
    parsed = simplify(parsed);
  }

  return {
    parsed,
    chunks,
    compressed,
  };
};

module.exports.addChunk = (chunks, after, marker, type, value) => {
  const newChunk = writeValue(marker, type, value);
  const chunkIndex = chunks.indexOf(after.chunk) + 1;
  chunks.splice(chunkIndex, 0, newChunk);
};

module.exports.modifyChunk = (chunks, toModify, newValue) => {
  const chunkIndex = chunks.indexOf(toModify.chunk);
  chunks[chunkIndex] = toModify.chunk = writeValue(toModify.marker, toModify.type, newValue);
};

module.exports.deleteMod = (buffer, modid) => {
  const result = this.parse(buffer);

  const modBlockList = Object.keys(result.parsed)
      .filter((x) => x.startsWith('MOD_BLOCK_'))
      .map((x) => result.parsed[x]);

  for (const modBlock of modBlockList) {
    if (!modBlock) {
      continue;
    }
    const chunks = readArray0B(buffer, {pos: modBlock.marker.byteOffset + 8}).chunks;
    for (let i = 2; i < chunks.length; i++) {
      const c = chunks[i];
      const state = readState(c.slice(24), null);
      const id = readString(c.slice(24), state);
      if (id === modid) {
        chunks.splice(i, 1);
        chunks[1] = Buffer.concat([new Buffer([chunks[1][0] - 1]), chunks[1].slice(1)]);
        break;
      }
    }
    const modifyingChunkIndex = result.chunks.indexOf(modBlock.chunk);
    chunks.unshift(result.chunks[modifyingChunkIndex].slice(0, 8));
    result.chunks[modifyingChunkIndex] = Buffer.concat(chunks);
  }
  return result;
};

module.exports.addMod = (buffer, modId, modTitle) => {
  const result = this.parse(buffer);

  const modBlockList = Object.keys(result.parsed)
      .filter((x) => x.startsWith('MOD_BLOCK_'))
      .map((x) => result.parsed[x]);

  for (const modBlock of modBlockList) {
    if (!modBlock) {
      continue;
    }
    let chunks = readArray0B(buffer, {pos: modBlock.marker.byteOffset + 8}).chunks;
    chunks = addElementToArray0B(chunks, [
      {marker: GAME_DATA.MOD_ID, value: modId},
      {marker: GAME_DATA.MOD_TITLE, value: modTitle},
    ]);
    const modifyingChunkIndex = result.chunks.indexOf(modBlock.chunk);
    chunks.unshift(result.chunks[modifyingChunkIndex].slice(0, 8));
    result.chunks[modifyingChunkIndex] = Buffer.concat(chunks);
  }
  return result;
};

module.exports.deleteChunk = (chunks, toDelete) => {
  _.pull(chunks, toDelete.chunk);
};

if (!module.parent) {
  const argv = require('minimist')(process.argv.slice(2));

  if (!argv._.length) {
    console.log('Please pass the filename as the argument to the script.');
  } else {
    const buffer = new Buffer(fs.readFileSync(argv._[0]));
    const result = module.exports.parse(buffer, argv);
    console.log(util.inspect(result.parsed, false, null));

    if (argv.outputCompressed) {
      fs.writeFileSync(path.basename(argv._[0]) + '.bin', result.compressed);
    }
  }
}

// Helper functions

function writeValue(marker, type, value) {
  switch (type) {
    case DATA_TYPES.INTEGER:
      return writeInt(marker, value);

    case DATA_TYPES.ARRAY_START:
      return writeArrayLen(marker, value);

    case DATA_TYPES.STRING:
      return writeString(marker, value);

    case DATA_TYPES.BOOLEAN:
      return writeBoolean(marker, value);

    default:
      throw new Error('I don\'t know how to write type ' + type);
  }
}

function simplify(result) {
  let mapFn = _.mapValues;

  if (_.isArray(result)) {
    mapFn = _.map;
  }

  return mapFn(result, (i) =>{
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
      next4: buffer.slice(0, 4),
    };
  } else {
    if (state.pos >= buffer.length - 4) {
      return null;
    }

    state.next4 = buffer.slice(state.pos, state.pos + 4);
  }

  return state;
}

function parseEntry(buffer, state, dontSkip) {
  let successfulParse;
  let result;

  do {
    const typeBuffer = buffer.slice(state.pos + 4, state.pos + 8);

    result = {
      marker: state.next4,
      type: typeBuffer.readUInt32LE(),
    };

    state.pos += 8;

    successfulParse = true;

    if (!dontSkip && (result.marker.readUInt32LE() < 256 || result.type === 0)) {
      result.data = 'SKIP';
    } else if (result.type === 0x18 || typeBuffer.slice(0, 2).equals(ZLIB_HEADER)) {
      // compressed data, skip for now...
      result.data = 'UNKNOWN COMPRESSED DATA';
      state.pos = buffer.indexOf(COMPRESSED_DATA_END, state.pos) + 4;
      state.readCompressedData = true;
    } else {
      switch (result.type) {
        case DATA_TYPES.BOOLEAN:
          result.data = readBoolean(buffer, state);
          break;

        case DATA_TYPES.INTEGER:
          result.data = readInt(buffer, state);
          break;
        case DATA_TYPES.ARRAY_START:
          result.data = readArray0A(buffer, state);
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
        case DATA_TYPES.STRING:
          result.data = readString(buffer, state);
          break;

        case DATA_TYPES.UTF_STRING:
          result.data = readUtfString(buffer, state);
          break;

        case 0x14:
        case 0x0D:
          result.data = 'UNKNOWN!';
          state.pos += 16;
          break;

        case 0x0B:
          result.data = readArray0B(buffer, state).data;
          break;

        default:
          successfulParse = false;
          state.pos -= 7;
          break;
      }
    }
  } while (!successfulParse);

  return result;
}

function readString(buffer, state) {
  const origState = _.clone(state);
  let result = null;

  // Length can be up to 3 bytes, but the 4th byte is a marker?
  const strLenBuf = Buffer.concat([buffer.slice(state.pos, state.pos + 3), new Buffer([0])]);
  const strLen = strLenBuf.readUInt32LE(0);
  state.pos += 2;

  const strInfo = buffer.slice(state.pos, state.pos + 6);
  // new Buffer([0, 0x21, 1, 0, 0, 0]))
  if (strInfo[1] === 0 || strInfo[1] === 0x20) {
    state.pos += 10;
    result = 'Don\'t know what this kind of string is...';
  } else if (strInfo[1] === 0x21) {
    state.pos += 6;
    // Instead of assuming string length is actually length of chunk, find our null terminator in the string...
    const nullTerm = buffer.indexOf(0, state.pos) - state.pos;
    result = buffer.slice(state.pos, state.pos + nullTerm).toString();
    state.pos += strLen;
  }

  if (result === null) {
    return 'Error reading string: ' + JSON.stringify(origState);
  }

  return result;
}

function readArray0A(buffer, state) {
  const result = [];

  state.pos += 8;
  const arrayLen = buffer.readUInt32LE(state.pos);
  log('array length ' + arrayLen);
  state.pos += 4;

  for (let i = 0; i < arrayLen; i++) {
    const index = buffer.readUInt32LE(state.pos);

    if (index > arrayLen) {
      // If we can't understand the array format, just return what we parsed for length
      log('Index outside bounds of array at ' + state.pos.toString(16));
      return arrayLen;
    }

    log(`reading array index ${index} at ${state.pos.toString(16)}`);

    state = readState(buffer, state);
    const info = parseEntry(buffer, state, true);
    result.push(info.data);
  }

  return result;
}

function addElementToArray0B(chunks, markerValues) {
  if (chunks.length < 3) {
    // (Chunk 0: marker, 1: size, 2: first entry that we copy to make new entry)
    throw new Error('Array must already have at least one entry!');
  }

  chunks[1] = Buffer.concat([new Buffer([chunks[1][0] + 1]), chunks[1].slice(1)]);
  const cloneChunk = Buffer.from(chunks[2]);
  const newSubChunks = [];

  let state = readState(cloneChunk, null);
  let chunkStart = 0;

  while (state) {
    const entry = parseEntry(cloneChunk, state);
    entry.chunk = cloneChunk.slice(chunkStart, state.pos);
    newSubChunks.push(entry.chunk);
    chunkStart = state.pos;

    for (const {marker, value} of markerValues) {
      if (entry.marker.equals(marker)) {
        module.exports.modifyChunk(newSubChunks, entry, value);
      }
    }

    state = readState(cloneChunk, state);
  }

  chunks.push(Buffer.concat(newSubChunks));

  return chunks;
}

function readArray0B(buffer, state) {
  const origState = _.clone(state);
  const result = {
    data: [],
    chunks: [],
  };

  result.chunks.push(buffer.slice(state.pos, state.pos + 8));
  state.pos += 8;
  const arrayLen = buffer.readUInt32LE(state.pos);

  result.chunks.push(buffer.slice(state.pos, state.pos + 4));
  state.pos += 4;

  for (let i = 0; i < arrayLen; i++) {
    if (buffer[state.pos] !== 0x0A) {
      return 'Error reading array: ' + JSON.stringify(origState);
    }

    const startPos = state.pos;
    state.pos += 16;
    const curData = {};
    result.data.push(curData);
    let info;

    do {
      state = readState(buffer, state);
      info = parseEntry(buffer, state);

      for (const key in GAME_DATA) {
        if (info.marker.equals(GAME_DATA[key])) {
          curData[key] = info;
        }
      }
    } while (info.data !== '1');

    result.chunks.push(buffer.slice(startPos, state.pos));
  }

  return result;
}

function writeString(marker, newValue) {
  const safeValue = iconv.encode(diacritics.remove(newValue), 'ascii');
  const strLenBuffer = new Buffer([0, 0, 0, 0x21, 1, 0, 0, 0]);
  strLenBuffer.writeUInt16LE(safeValue.length + 1, 0);

  return Buffer.concat([marker, new Buffer([5, 0, 0, 0]), strLenBuffer, myBufferFrom(safeValue), new Buffer([0])]);
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
    return 'Error reading string: ' + JSON.stringify(origState);
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

function writeBoolean(marker, value) {
  const valueBuffer = Buffer.alloc(4);
  valueBuffer.writeUInt32LE(value ? 1 : 0);

  return Buffer.concat([marker, Buffer.from([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), valueBuffer]);
}

function readCompressedData(buffer, state) {
  const data = buffer.slice(state.pos + 4, buffer.indexOf(COMPRESSED_DATA_END, state.pos) + COMPRESSED_DATA_END.length);

  // drop 4 bytes away after every chunk
  const chunkSize = 64 * 1024;
  const chunks = [];
  let pos = 0;
  while (pos < data.length) {
    chunks.push(data.slice(pos, pos + chunkSize));
    pos += chunkSize + 4;
  }
  const compressedData = Buffer.concat(chunks);

  return zlib.unzipSync(compressedData, {finishFlush: zlib.Z_SYNC_FLUSH});
}

function myBufferFrom(source) {
  if (useNewBuffer) {
    return new Buffer(source);
  }

  return Buffer.from(source);
}
