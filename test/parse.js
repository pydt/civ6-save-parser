'use strict';

const fs = require('fs');
const expect = require('chai').expect;
const civ6 = require('../index.js');

describe('Parse Cathy Save', () => {
  const buffer = new Buffer(fs.readFileSync('test/saves/CATHERINE DE MEDICI 1 4000 BC.Civ6Save'));
  const parsed = civ6.parse(buffer);
  const parsedSimple = civ6.parse(buffer, { simple: true });

  it('should have 4 civs', () => {
    expect(parsed.CIVS.length).to.equal(4);
    expect(parsedSimple.CIVS.length).to.equal(4);
  });

  it('should have 7 actors', () => {
    expect(parsed.ACTORS.length).to.equal(7);
    expect(parsedSimple.ACTORS.length).to.equal(7);
  });

  it('is game turn 1', () => {
    expect(parsed.GAME_TURN.data).to.equal(1);
    expect(parsedSimple.GAME_TURN).to.equal(1);
  });

  it('is player 1\'s turn', () => {
    expect(parsed.CIVS[0].data.IS_CURRENT_TURN.data).to.equal(true);
    expect(parsedSimple.CIVS[0].IS_CURRENT_TURN).to.equal(true);

    for (let i = 1; i < parsed.CIVS.length; i++) {
      expect(parsed.CIVS[i].data).to.not.have.property('IS_CURRENT_TURN'); // AMBIGUOUS - in this case, the value does not exist at all in the file
      expect(parsedSimple.CIVS[i].IS_CURRENT_TURN).to.not.be.ok;
    }
  });

  it('should have civs in the correct order', () => {
    for (let i = 0; i < parsed.CIVS.length; i++) {
      expect(parsed.CIVS[i].data.PLAYER_NAME.data).to.equal('Player ' + (i + 1));
      expect(parsedSimple.CIVS[i].PLAYER_NAME).to.equal('Player ' + (i + 1));
    }
  });
});

describe('Parse Hojo Save', () => {
  const buffer = new Buffer(fs.readFileSync('test/saves/HŌJŌ TOKIMUNE 341 1920 d. C..Civ6Save'));
  const parsed = civ6.parse(buffer);
  const parsedSimple = civ6.parse(buffer, { simple: true });

  it('should have 6 civs', () => {
    expect(parsed.CIVS.length).to.equal(6);
    expect(parsedSimple.CIVS.length).to.equal(6);
  });
});

describe('Parse 144', () => {
  const buffer = new Buffer(fs.readFileSync('test/saves/000144.Civ6Save'));
  const parsed = civ6.parse(buffer);
  const parsedSimple = civ6.parse(buffer, { simple: true });

  it('should have 4 civs', () => {
    expect(parsed.CIVS.length).to.equal(4);
    expect(parsedSimple.CIVS.length).to.equal(4);
  });

  it('should be player 3\'s turn', () => {
    expect(parsed.CIVS[2].data.IS_CURRENT_TURN.data).to.equal(true);
    expect(parsedSimple.CIVS[2].IS_CURRENT_TURN).to.equal(true);

    for (let i = 0; i < parsed.CIVS.length; i++) {
      if (i != 2) {
        expect(parsed.CIVS[i].data.IS_CURRENT_TURN.data).to.equal(false); // AMBIGUOUS - in this case, the value exists in the file and is false
        expect(parsedSimple.CIVS[i].IS_CURRENT_TURN).to.not.be.ok;
      }
    }
  });
});

describe('Parse 203 Save', () => {
  const buffer = new Buffer(fs.readFileSync('test/saves/000203.Civ6Save'));
  const parsed = civ6.parse(buffer);
  const parsedSimple = civ6.parse(buffer, { simple: true });

  it('should have 4 civs', () => {
    expect(parsed.CIVS.length).to.equal(4);
    expect(parsedSimple.CIVS.length).to.equal(4);
  });
});

describe('Parse 12 Peeps Save', () => {
  const buffer = new Buffer(fs.readFileSync('test/saves/12peeps.Civ6Save'));
  const parsedSimple = civ6.parse(buffer, { simple: true });

  it('should have 12 civs', () => {
    expect(parsedSimple.CIVS.length).to.equal(12);
  });

  it('should have correct data for the 12 civs', () => {
    expect(parsedSimple.CIVS[0].ACTOR_NAME).to.equal('CIVILIZATION_FRANCE');
    expect(parsedSimple.CIVS[0].LEADER_NAME).to.equal('LEADER_CATHERINE_DE_MEDICI');
    
    expect(parsedSimple.CIVS[1].ACTOR_NAME).to.equal('CIVILIZATION_EGYPT');
    expect(parsedSimple.CIVS[1].LEADER_NAME).to.equal('LEADER_CLEOPATRA');

    expect(parsedSimple.CIVS[2].ACTOR_NAME).to.equal('CIVILIZATION_GERMANY');
    expect(parsedSimple.CIVS[2].LEADER_NAME).to.equal('LEADER_BARBAROSSA');

    expect(parsedSimple.CIVS[3].ACTOR_NAME).to.equal('CIVILIZATION_INDIA');
    expect(parsedSimple.CIVS[3].LEADER_NAME).to.equal('LEADER_GANDHI');
    
    expect(parsedSimple.CIVS[4].ACTOR_NAME).to.equal('CIVILIZATION_SUMERIA');
    expect(parsedSimple.CIVS[4].LEADER_NAME).to.equal('LEADER_GILGAMESH');

    expect(parsedSimple.CIVS[5].ACTOR_NAME).to.equal('CIVILIZATION_GREECE');
    expect(parsedSimple.CIVS[5].LEADER_NAME).to.equal('LEADER_GORGO');
    
    expect(parsedSimple.CIVS[6].ACTOR_NAME).to.equal('CIVILIZATION_NORWAY');
    expect(parsedSimple.CIVS[6].LEADER_NAME).to.equal('LEADER_HARDRADA');
    
    expect(parsedSimple.CIVS[7].ACTOR_NAME).to.equal('CIVILIZATION_JAPAN');
    expect(parsedSimple.CIVS[7].LEADER_NAME).to.equal('LEADER_HOJO');
    
    expect(parsedSimple.CIVS[8].ACTOR_NAME).to.equal('CIVILIZATION_AZTEC');
    expect(parsedSimple.CIVS[8].LEADER_NAME).to.equal('LEADER_MONTEZUMA');
    
    expect(parsedSimple.CIVS[9].ACTOR_NAME).to.equal('CIVILIZATION_KONGO');
    expect(parsedSimple.CIVS[9].LEADER_NAME).to.equal('LEADER_MVEMBA');
    
    expect(parsedSimple.CIVS[10].ACTOR_NAME).to.equal('CIVILIZATION_BRAZIL');
    expect(parsedSimple.CIVS[10].LEADER_NAME).to.equal('LEADER_PEDRO');
    
    expect(parsedSimple.CIVS[11].ACTOR_NAME).to.equal('CIVILIZATION_GREECE');
    expect(parsedSimple.CIVS[11].LEADER_NAME).to.equal('LEADER_PERICLES');
  });
});
