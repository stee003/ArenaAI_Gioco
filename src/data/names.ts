import type { FactionId } from '../sim/types';

/** Per-culture name banks. Agents, rulers and patrons are assembled from these. */

export const CITY_NAMES: Record<FactionId, string[]> = {
  concord: ['Marenza', 'Ostavin', 'Caldemar', 'Vessine', 'Belhora'],
  khanate: ['Sarkel', 'Tumen-Kho', 'Khara-Su', 'Borogol', 'Ordu-Balg'],
  vault: ['Anavrat', 'Idris-Va', 'Zarra-Kal', 'Sumer-Va', 'Ninth Gate'],
  compact: ['Fernmark', 'Stolbrand', 'Karrek Deep', 'Dunmoor', 'Anvilreach'],
  delta: ['Suthra', 'Kalamesh', 'Anubeen', 'Tel-Maru', 'Kesvan'],
};

interface PersonBank {
  first: string[];
  last: string[];
  /** Optional patronymic style instead of surnames. */
  patronymic?: (rngPick: (arr: string[]) => string, genderRoll: number) => string;
}

export const PERSON_NAMES: Record<FactionId, PersonBank> = {
  concord: {
    first: ['Aldous', 'Elira', 'Tommaso', 'Vessa', 'Joran', 'Odile', 'Perrin', 'Marisol', 'Casso', 'Berenice', 'Lucan', 'Fiora'],
    last: ['Marchetti', 'Solari', 'Ventre', 'Alderisi', 'Corvane', 'Delmar', 'Quist', 'Sarzan'],
  },
  khanate: {
    first: ['Batu', 'Aigul', 'Temur', 'Qara', 'Ozbeg', 'Selenge', 'Borte', 'Yesun', 'Mangke', 'Altan', 'Sarnai', 'Khaidu'],
    last: ['Ironbow', 'Grey-Tent', 'Wolf-Son', 'the Herder', 'Swift-Ash', 'Nine-Oaths'],
    patronymic: (pick, g) => `${g % 2 === 0 ? 'son' : 'daughter'} of ${pick(['Temur', 'Qara', 'Borte', 'Mangke', 'Altan', 'Yesun'])}`,
  },
  vault: {
    first: ['Yasha', 'Iram', 'Nadir', 'Shirin', 'Farid', 'Leila', 'Zubair', 'Mahrud', 'Davud', 'Gulnaz', 'Samhar', 'Rukhsana'],
    last: ['ibn Samhar', 'of the Ninth Gate', 'al-Virati', 'the Copyist', 'of Zarra', 'the Astronomer'],
  },
  compact: {
    first: ['Hild', 'Bram', 'Goswin', 'Adela', 'Rurik', 'Marta', 'Wendel', 'Otthild', 'Falk', 'Siglinde', 'Emeric', 'Brunhild'],
    last: ['Ironhand', 'Deepdel', 'Cooper', 'Stonehewer', 'Anvilwright', 'Grimm', 'Tarrant', 'Voss'],
  },
  delta: {
    first: ['Sadi', 'Amara', 'Kesh', 'Liora', 'Baram', 'Zohra', 'Ilan', 'Nima', 'Hafez', 'Tamar', 'Raz', 'Shadi'],
    last: ['Floodgate', 'Reedwalker', 'of the Long Quay', 'Sunsoaked', 'Halfmoon', 'Riverborn'],
  },
};

export const EPITHETS = [
  'the Lucky', 'Twice-Robbed', 'the Patient', 'of the Long Road', 'Silkhand',
  'the Grain Wolf', 'Storm-Chaser', 'the Quiet', 'Ironpurse', 'the Fox',
  'the Generous', 'Oathbreaker', 'the Undrowned', 'Cold-Eye', 'the Late',
  'Amber-Fingered', 'the Pious', 'Road-Weary', 'the Swift', 'Half-Share',
];

export const BANDIT_CHIEF_NAMES = [
  'Kestrel the Black', 'One-Eyed Saru', 'Mother of Knives', 'The Ash Prince',
  'Grey Halim', 'Sister Sorrow', 'The Tollkeeper', 'Broken-Tooth Yev',
  'The Winter Fox', 'Copper Hand', 'The Pilgrim (who was not)', 'Rattle-Bones Zuk',
];

export const CARAVANSERAI_NAMES = [
  'The Copper Lantern', 'House of Wayfarers', 'The Rested Camel', 'Wellspring Inn',
  'The Open Gate', 'Pilgrim\u2019s Shade', 'The Salt Cup', 'Hearth of Strangers',
  'The Long Shadow', 'Moonwell Caravanserai', 'The Balanced Scale', 'Dust & Dream',
];

export const AI_CARAVAN_NAMES = [
  'The North Star', 'Uncle\u2019s Promise', 'Patient Cargo', 'The Second Mule',
  'Fortune\u2019s Hem', 'The Quiet Profit', 'Road-Singer', 'The Late Bloom',
  'Amber Ledger', 'The Steady Wheel',
];

export const WORLD_CHRONICLE = 'The Zeravesh Chronicle';
