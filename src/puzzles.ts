// Puzzle content for the Acts 4 Connections game. Pure data - no game logic
// lives here (see src/shared/game.ts for that).
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
