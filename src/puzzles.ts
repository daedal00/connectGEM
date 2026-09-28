// Puzzle content. Pure data - no game logic lives here (see src/shared/game.ts).
//
// Two kinds, played in that order on the night:
//   warmup    - everyday Connections, no Bible knowledge needed, so the room
//               learns the mechanic (and the "one word, two homes" trap)
//               before the passage rounds.
//   scripture - built from Acts 4:29-37. At least one group is lifted
//               straight from the text, so reading the passage helps.
//
// Difficulty runs 0-3 (yellow, green, blue, purple) and is the intended
// solving order. The purple group is the wordplay trap: at least one of its
// words should look like it belongs to an easier group. MARS wanting to be a
// planet, SORRY wanting to be a board game, FARM wanting to be land - that
// pull is the whole game.
import type { Puzzle, PuzzleSummary } from './shared/types.ts'
import { summarize } from './shared/game.ts'

export const PUZZLES: Puzzle[] = [
  // --- Warm-ups ---
  {
    id: 'warmup-space',
    title: 'Out of This World',
    kind: 'warmup',
    scripture: null,
    groups: [
      { id: 'g0', name: 'BREAKFAST FOODS', difficulty: 0, members: ['PANCAKE', 'WAFFLE', 'BACON', 'CEREAL'] },
      { id: 'g1', name: 'PLANETS', difficulty: 1, members: ['MERCURY', 'VENUS', 'SATURN', 'JUPITER'] },
      { id: 'g2', name: 'CANDY BARS', difficulty: 2, members: ['SNICKERS', 'TWIX', 'MILKY WAY', 'MARS'] },
      { id: 'g3', name: '___BALL', difficulty: 3, members: ['SNOW', 'DODGE', 'MEAT', 'FOOT'] },
    ],
  },
  {
    id: 'warmup-game-night',
    title: 'Game Night',
    kind: 'warmup',
    scripture: null,
    groups: [
      { id: 'g0', name: 'CARD GAMES', difficulty: 0, members: ['UNO', 'SPOONS', 'WAR', 'GO FISH'] },
      { id: 'g1', name: 'BOARD GAMES', difficulty: 1, members: ['MONOPOLY', 'CLUE', 'RISK', 'SCRABBLE'] },
      { id: 'g2', name: 'WHAT YOU SAY WHEN YOU BUMP INTO SOMEONE', difficulty: 2, members: ['SORRY', 'OOPS', 'PARDON', 'EXCUSE ME'] },
      { id: 'g3', name: '___BOARD', difficulty: 3, members: ['SKATE', 'SURF', 'CHALK', 'CUP'] },
    ],
  },
  {
    id: 'warmup-weather',
    title: 'Weather Report',
    kind: 'warmup',
    scripture: null,
    groups: [
      { id: 'g0', name: 'PIZZA TOPPINGS', difficulty: 0, members: ['PEPPERONI', 'MUSHROOM', 'OLIVE', 'ONION'] },
      { id: 'g1', name: 'WEATHER', difficulty: 1, members: ['SNOW', 'HAIL', 'FOG', 'SLEET'] },
      { id: 'g2', name: 'SUPERHEROES', difficulty: 2, members: ['BATMAN', 'THOR', 'HULK', 'STORM'] },
      { id: 'g3', name: '___COAT', difficulty: 3, members: ['RAIN', 'PEA', 'LAB', 'TRENCH'] },
    ],
  },

  // --- Acts 4 ---
  {
    id: 'acts4-unity',
    title: 'All Things In Common',
    kind: 'scripture',
    scripture: 'Acts 4:32-35',
    groups: [
      { id: 'g0', name: 'ONE ___', difficulty: 0, members: ['HEART', 'MIND', 'SOUL', 'SPIRIT'] },
      { id: 'g1', name: 'WHAT THEY DID WITH IT (v34-35)', difficulty: 1, members: ['SOLD', 'BROUGHT', 'LAID', 'DISTRIBUTED'] },
      { id: 'g2', name: 'WHAT THEY OWNED', difficulty: 2, members: ['LAND', 'HOUSES', 'MONEY', 'POSSESSIONS'] },
      { id: 'g3', name: '___ GRACE', difficulty: 3, members: ['AMAZING', 'SAVING', 'SAYING', 'GREAT'] },
    ],
  },
  {
    id: 'acts4-need',
    title: 'No Needy Among Them',
    kind: 'scripture',
    scripture: 'Acts 4:33-35',
    groups: [
      { id: 'g0', name: 'IN NEED', difficulty: 0, members: ['NEEDY', 'LACK', 'WANT', 'POOR'] },
      { id: 'g1', name: 'NAMED IN ACTS 4', difficulty: 1, members: ['BARNABAS', 'PETER', 'JOHN', 'CAIAPHAS'] },
      { id: 'g2', name: 'IN VERSE 33', difficulty: 2, members: ['POWER', 'GRACE', 'TESTIMONY', 'RESURRECTION'] },
      { id: 'g3', name: '___ FEET', difficulty: 3, members: ['APOSTLES', 'BARE', 'COLD', 'SQUARE'] },
    ],
  },
  {
    id: 'acts4-barnabas',
    title: 'Son of Encouragement',
    kind: 'scripture',
    scripture: 'Acts 4:36-37',
    groups: [
      { id: 'g0', name: 'TO CHEER SOMEONE ON', difficulty: 0, members: ['ENCOURAGE', 'SUPPORT', 'BUILD', 'LIFT'] },
      { id: 'g1', name: 'A PIECE OF LAND', difficulty: 1, members: ['FIELD', 'ACRE', 'LOT', 'PLOT'] },
      { id: 'g2', name: 'BARNABAS FACT FILE (v36)', difficulty: 2, members: ['JOSEPH', 'LEVITE', 'CYPRUS', 'SON'] },
      { id: 'g3', name: '___ HAND', difficulty: 3, members: ['FARM', 'SECOND', 'UPPER', 'OFF'] },
    ],
  },
  {
    id: 'acts4-boldness',
    title: 'Speak With Boldness',
    kind: 'scripture',
    scripture: 'Acts 4:29-31',
    groups: [
      { id: 'g0', name: 'BRAVE', difficulty: 0, members: ['BOLD', 'FEARLESS', 'DARING', 'GUTSY'] },
      { id: 'g1', name: 'WAYS TO SAY IT OUT LOUD', difficulty: 1, members: ['DECLARE', 'PROCLAIM', 'ANNOUNCE', 'TESTIFY'] },
      { id: 'g2', name: 'IN VERSE 31', difficulty: 2, members: ['PRAYED', 'SHAKEN', 'GATHERED', 'FILLED'] },
      { id: 'g3', name: '___ ROOM', difficulty: 3, members: ['UPPER', 'ELBOW', 'LIVING', 'LEG'] },
    ],
  },
  {
    id: 'acts4-claim',
    title: 'No One Claimed It as His Own',
    kind: 'scripture',
    scripture: 'Acts 4:32',
    groups: [
      { id: 'g0', name: 'TO OWN SOMETHING', difficulty: 0, members: ['CLAIM', 'KEEP', 'HOLD', 'HAVE'] },
      { id: 'g1', name: 'TO LET IT GO', difficulty: 1, members: ['SURRENDER', 'RELEASE', 'YIELD', 'FORFEIT'] },
      { id: 'g2', name: 'THE PRAYER IN v29-30 ASKS FOR', difficulty: 2, members: ['BOLDNESS', 'HEALING', 'SIGNS', 'WONDERS'] },
      { id: 'g3', name: '___ PROPERTY', difficulty: 3, members: ['PERSONAL', 'PRIVATE', 'INTELLECTUAL', 'LOST'] },
    ],
  },
]

// A duplicate word across groups silently breaks the word -> group index,
// which breaks tap legality and guess evaluation for that word. Fail loudly
// at module load rather than serve a broken board.
function assertValidPuzzle(puzzle: Puzzle): void {
  if (puzzle.groups.length !== 4) {
    throw new Error(`puzzle "${puzzle.id}" must have exactly 4 groups, got ${puzzle.groups.length}`)
  }
  const seen = new Set<string>()
  for (const group of puzzle.groups) {
    if (group.members.length !== 4) {
      throw new Error(`puzzle "${puzzle.id}" group "${group.id}" must have exactly 4 words, got ${group.members.length}`)
    }
    for (const word of group.members) {
      if (seen.has(word)) {
        throw new Error(`puzzle "${puzzle.id}" has duplicate word "${word}" across groups`)
      }
      seen.add(word)
    }
  }
}

const ids = new Set<string>()
for (const puzzle of PUZZLES) {
  assertValidPuzzle(puzzle)
  if (ids.has(puzzle.id)) throw new Error(`duplicate puzzle id "${puzzle.id}"`)
  ids.add(puzzle.id)
}

// What the admin puzzle picker renders - never ships the answer key.
// Order matters: the admin's "Next puzzle" button walks this list.
export function puzzleSummaries(): PuzzleSummary[] {
  return PUZZLES.map(summarize)
}
