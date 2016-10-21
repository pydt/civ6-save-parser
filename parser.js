'use strict';

const fs = require('fs');

(() => {
  module.exports.parse = (filename) => {
    return new Promise((fulfill, reject) => {
      fs.readFile(filename, (err, data) => {
        if (err) {
          reject(err);
        } else {
          const result = {};
          const buffer = new Buffer(data);

          // Current game turn is at hex position 0x28
          result.turn = buffer.readUInt32LE(0x28);

          let chunk = {
            endIndex: 0
          };

          while (null !== (chunk = getChunk(buffer, chunk.endIndex))) {
            if (chunk.data) {
              console.log(chunk);
            }
          }

          fulfill(result);
        }
      });
    });
  };

  if (!module.parent) {
    if (process.argv.length < 3) {
      console.log('Please pass the filename as the argument to the script.');
    } else {
      module.exports.parse(process.argv[2]).then(result => {
        console.log(result);
      });
    }
  }
})();

// Parse helper functions

const CHUNK_KEYS = {
  98152601: "GAME_SPEED",
  193158208: "MAP_SIZE"
};

function getChunk(buffer, startIndex) {
  const stringDelimiter = new Buffer([5, 0, 0, 0]);

  const result = {
    startIndex: buffer.indexOf(stringDelimiter, startIndex)
  };

  if (result.startIndex > 0) {
    const strLen = buffer.readUInt16LE(result.startIndex + 4);

    if (buffer.indexOf(new Buffer([0, 0x21, 1, 0, 0, 0]), result.startIndex) === result.startIndex + 6) {
      result.rawKey = buffer.readUInt32LE(result.startIndex - 4);

      if (CHUNK_KEYS[result.rawKey]) {
        result.key = CHUNK_KEYS[result.rawKey];
      }

      result.endIndex = result.startIndex + 12 + strLen;
      result.data = buffer.slice(result.startIndex + 12, result.endIndex).toString();
    } else {
      result.endIndex = result.startIndex + 4;
    }

    return result;
  }

  return null;
}
