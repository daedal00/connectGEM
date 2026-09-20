// Puzzle content for the Acts 4 Connections game. Pure data - no game logic
// lives here (see src/shared/game.ts for that).
//
// Difficulty runs 0-3 (yellow, green, blue, purple) and is the intended
// solving order, not a colour choice. The purple group is always the wordplay
// trap: at least one of its words has to look like it belongs to an easier
// group, or the puzzle solves itself top to bottom. COLLECTION PLATE pulling
// against SUNDAY MORNING, or BEAR wanting WITNESS, are the whole game.
import type { Puzzle, PuzzleSummary } from './shared/types.ts'

export const PUZZLES: Puzzle[] = [
  {
    id: 'acts4-unity',
    title: 'All Things In Common',
    scripture: 'Acts 4:32-35',
    groups: [
      { id: 'g0', name: 'ONE IN ___', difficulty: 0, members: ['HEART', 'MIND', 'SOUL', 'SPIRIT'] },
      { id: 'g1', name: 'WHAT THEY DID WITH IT', difficulty: 1, members: ['SOLD', 'BROUGHT', 'LAID', 'DISTRIBUTED'] },
      { id: 'g2', name: 'WHAT THEY OWNED', difficulty: 2, members: ['LAND', 'HOUSES', 'MONEY', 'POSSESSIONS'] },
      { id: 'g3', name: '___ GRACE', difficulty: 3, members: ['AMAZING', 'SAVING', 'SAYING', 'PERIOD'] },
    ],
  },
  {
    id: 'acts4-need',
    title: 'No Needy Among Them',
    scripture: 'Acts 4:32-35',
    groups: [
      { id: 'g0', name: 'IN NEED', difficulty: 0, members: ['NEEDY', 'LACK', 'WANT', 'POOR'] },
      { id: 'g1', name: 'IN ACTS 4', difficulty: 1, members: ['BARNABAS', 'PETER', 'JOHN', 'ANANIAS'] },
      { id: 'g2', name: 'THEY DEVOTED THEMSELVES TO', difficulty: 2, members: ['TEACHING', 'FELLOWSHIP', 'BREAKING', 'PRAYER'] },
      { id: 'g3', name: '___ FEET', difficulty: 3, members: ['APOSTLES', 'BARE', 'COLD', 'SQUARE'] },
    ],
  },
  {
    id: 'acts4-need-none',
    title: 'Not One in Need',
    scripture: 'Acts 4:34',
    groups: [
      { id: 'g0', name: 'TO HAND OVER', difficulty: 0, members: ['GIVE', 'OFFER', 'GRANT', 'SUPPLY'] },
      { id: 'g1', name: 'PEOPLE IN ACTS', difficulty: 1, members: ['STEPHEN', 'PHILIP', 'LYDIA', 'SAUL'] },
      { id: 'g2', name: 'SUNDAY MORNING', difficulty: 2, members: ['WORSHIP', 'SERMON', 'HYMN', 'WELCOME'] },
      { id: 'g3', name: '___ PLATE', difficulty: 3, members: ['COLLECTION', 'HOME', 'LICENSE', 'PAPER'] },
    ],
  },
  {
    id: 'acts4-common',
    title: 'Held in Common',
    scripture: 'Acts 4:32',
    groups: [
      { id: 'g0', name: 'WHAT THEY SHARED', difficulty: 0, members: ['FOOD', 'HOMES', 'MONEY', 'TIME'] },
      { id: 'g1', name: 'A MEAL TOGETHER', difficulty: 1, members: ['SUPPER', 'FEAST', 'BANQUET', 'POTLUCK'] },
      { id: 'g2', name: 'SIGNS IN THE EARLY CHURCH', difficulty: 2, members: ['WONDERS', 'MIRACLES', 'TONGUES', 'HEALING'] },
      { id: 'g3', name: 'COMMON ___', difficulty: 3, members: ['SENSE', 'GROUND', 'COLD', 'DENOMINATOR'] },
    ],
  },
  {
    id: 'acts4-barnabas',
    title: 'Son of Encouragement',
    scripture: 'Acts 4:36-37',
    groups: [
      { id: 'g0', name: 'TO CHEER SOMEONE ON', difficulty: 0, members: ['ENCOURAGE', 'SUPPORT', 'BUILD', 'LIFT'] },
      { id: 'g1', name: 'A PIECE OF LAND', difficulty: 1, members: ['FIELD', 'ACRE', 'LOT', 'PLOT'] },
      { id: 'g2', name: 'WHAT THE APOSTLES DID', difficulty: 2, members: ['PREACH', 'BAPTIZE', 'TEACH', 'PRAY'] },
      { id: 'g3', name: '___ HAND', difficulty: 3, members: ['FARM', 'SECOND', 'UPPER', 'OFF'] },
    ],
  },
  {
    id: 'acts4-boldness',
    title: 'Speak With Boldness',
    scripture: 'Acts 4:29-31',
    groups: [
      { id: 'g0', name: 'BRAVE', difficulty: 0, members: ['BOLD', 'FEARLESS', 'DARING', 'GUTSY'] },
      { id: 'g1', name: 'WAYS TO SAY IT OUT LOUD', difficulty: 1, members: ['DECLARE', 'PROCLAIM', 'ANNOUNCE', 'TESTIFY'] },
      { id: 'g2', name: 'WHERE ACTS 4 HAPPENS', difficulty: 2, members: ['TEMPLE', 'PRISON', 'COURT', 'GATE'] },
      { id: 'g3', name: '___ ROOM', difficulty: 3, members: ['UPPER', 'ELBOW', 'LIVING', 'LEG'] },
    ],
  },
  {
    id: 'acts4-witness',
    title: 'With Great Power They Testified',
    scripture: 'Acts 4:33',
    groups: [
      { id: 'g0', name: 'TELLING WHAT YOU SAW', difficulty: 0, members: ['WITNESS', 'REPORT', 'ACCOUNT', 'TESTIMONY'] },
      { id: 'g1', name: 'RESURRECTION MORNING', difficulty: 1, members: ['RISEN', 'ALIVE', 'EMPTY', 'STONE'] },
      { id: 'g2', name: 'YOUTH NIGHT', difficulty: 2, members: ['GAMES', 'SNACKS', 'MUSIC', 'TALK'] },
      { id: 'g3', name: 'BEAR ___', difficulty: 3, members: ['FRUIT', 'ARMS', 'HUG', 'MARKET'] },
    ],
  },
  {
    id: 'acts4-claim',
    title: 'No One Claimed It as His Own',
    scripture: 'Acts 4:32',
    groups: [
      { id: 'g0', name: 'TO OWN SOMETHING', difficulty: 0, members: ['CLAIM', 'KEEP', 'HOLD', 'HAVE'] },
      { id: 'g1', name: 'TO LET IT GO', difficulty: 1, members: ['SURRENDER', 'RELEASE', 'YIELD', 'FORFEIT'] },
      { id: 'g2', name: 'THE JERUSALEM CHURCH', difficulty: 2, members: ['BELIEVERS', 'PRAYERS', 'SIGNS', 'WONDERS'] },
      { id: 'g3', name: '___ PROPERTY', difficulty: 3, members: ['PERSONAL', 'PRIVATE', 'INTELLECTUAL', 'LOST'] },
    ],
  },
]

// A duplicate word across groups silently breaks the word -> group index
// (game.ts's indexWords keeps only the last group a word maps to), which
// breaks tap legality and guess evaluation for that word. Fail loudly at
// module load rather than serve a broken board.
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

for (const puzzle of PUZZLES) assertValidPuzzle(puzzle)

// What the admin puzzle picker renders - never ships the answer key.
export function puzzleSummaries(): PuzzleSummary[] {
  return PUZZLES.map(({ id, title, scripture }) => ({ id, title, scripture }))
}
