'use strict';

const fs = require('fs');
const expect = require('chai').expect;
const civ6 = require('../index.js');

describe('Modify Cathy Save', function() {
  let buffer = new Buffer(fs.readFileSync('test/saves/CATHERINE DE MEDICI 1 4000 BC.Civ6Save'));
  const data = civ6.parse(buffer);

  it('should be able to change player names in any order', () => {
    civ6.modifyChunk(data.chunks, data.parsed.CIVS[0].data.PLAYER_NAME, 'Mike Rosack 0');
    civ6.modifyChunk(data.chunks, data.parsed.CIVS[2].data.PLAYER_NAME, 'Mike Rosack 2');
    civ6.modifyChunk(data.chunks, data.parsed.CIVS[1].data.PLAYER_NAME, 'Mike Rosack 1');
    buffer = Buffer.concat(data.chunks);

    const reparse = civ6.parse(buffer).parsed;

    expect(reparse.CIVS[0].data.PLAYER_NAME.data).to.equal('Mike Rosack 0');
    expect(reparse.CIVS[1].data.PLAYER_NAME.data).to.equal('Mike Rosack 1');
    expect(reparse.CIVS[2].data.PLAYER_NAME.data).to.equal('Mike Rosack 2');
  });

  it('should be able to add a password', () => {
    civ6.addChunk(data.chunks, data.parsed.CIVS[0].data.THING_BEFORE_PASSWORD, civ6.MARKERS.ACTOR_DATA.PLAYER_PASSWORD, 5, 'password1');
    civ6.modifyChunk(data.chunks, data.parsed.CIVS[0].data.SLOT_1_HEADER, data.parsed.CIVS[0].data.SLOT_1_HEADER.data + 1);

    civ6.addChunk(data.chunks, data.parsed.CIVS[1].data.THING_BEFORE_PASSWORD, civ6.MARKERS.ACTOR_DATA.PLAYER_PASSWORD, 5, 'password2');
    civ6.modifyChunk(data.chunks, data.parsed.CIVS[1].data.SLOT_2_HEADER, data.parsed.CIVS[1].data.SLOT_2_HEADER.data + 1);
    buffer = Buffer.concat(data.chunks);

    const reparse = civ6.parse(buffer).parsed;

    expect(reparse.CIVS[0].data.PLAYER_PASSWORD.data).to.equal('password1');
    expect(reparse.CIVS[1].data.PLAYER_PASSWORD.data).to.equal('password2');
  });

  it('should be able to change a human player to AI', () => {
    civ6.modifyChunk(data.chunks, data.parsed.CIVS[1].data.ACTOR_AI_HUMAN, 1);
    buffer = Buffer.concat(data.chunks);

    const reparse = civ6.parse(buffer).parsed;

    expect(reparse.CIVS[1].data.ACTOR_AI_HUMAN.data).to.equal(1);
  });

  /*it('writes the modified save file for debugging purposes', () => {
    fs.writeFileSync('test/saves/modified.Civ6Save', buffer);
  });*/
});