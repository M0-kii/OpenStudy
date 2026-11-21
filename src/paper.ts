import type { Paper } from './settings';

export const paperColors: Record<Paper, { background: string; color: string; link: string }> = {
  paper: { background: '#fafafa', color: '#0a0a0a', link: '#0a0a0a' },
  sepia: { background: '#f4ecd8', color: '#3b3021', link: '#6b4f1d' },
  night: { background: '#1b1a16', color: '#e8e3d6', link: '#d8b26a' },
};

let current: Paper = 'paper';

export function setPaper(paper: Paper): void {
  current = paper;
}

export function paperTheme(): typeof paperColors[Paper] {
  return paperColors[current];
}
