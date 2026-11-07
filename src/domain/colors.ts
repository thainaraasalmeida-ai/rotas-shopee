export interface GroupColor {
  key: string;
  name: string; // exibido em maiúsculas: "AZUL"
  bg: string;
  fg: string;
}

// Cores bem distintas entre si e com nome falado fácil (para separar no carro).
export const GROUP_COLORS: GroupColor[] = [
  { key: 'azul', name: 'Azul', bg: '#1E63D6', fg: '#fff' },
  { key: 'verde', name: 'Verde', bg: '#14934A', fg: '#fff' },
  { key: 'laranja', name: 'Laranja', bg: '#F07A10', fg: '#111' },
  { key: 'roxo', name: 'Roxo', bg: '#7B3FC4', fg: '#fff' },
  { key: 'vermelho', name: 'Vermelho', bg: '#D42A2A', fg: '#fff' },
  { key: 'amarelo', name: 'Amarelo', bg: '#F5C518', fg: '#111' },
  { key: 'rosa', name: 'Rosa', bg: '#E04A9C', fg: '#fff' },
  { key: 'marrom', name: 'Marrom', bg: '#7A4A26', fg: '#fff' },
  { key: 'ciano', name: 'Ciano', bg: '#11A3B8', fg: '#111' },
  { key: 'cinza', name: 'Cinza', bg: '#6B7280', fg: '#fff' },
  { key: 'preto', name: 'Preto', bg: '#111111', fg: '#fff' },
  { key: 'lima', name: 'Lima', bg: '#8CC63F', fg: '#111' },
];

export function groupColorKey(index: number): string {
  return GROUP_COLORS[(index - 1) % GROUP_COLORS.length].key;
}

export function colorOf(key: string): GroupColor {
  return GROUP_COLORS.find((c) => c.key === key) ?? GROUP_COLORS[0];
}
