const paths = {
  file:'M6 3h8l4 4v14H6z M14 3v5h4 M9 13h6 M9 17h4',
  bag:'M4 8h16l-1 13H5z M8 9V7a4 4 0 0 1 8 0v2',
  map:'m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z M9 3v15 M15 6v15',
  nav:'m21 3-7 18-3-8-8-3z',
  report:'M4 20h16 M7 16v-4 M12 16V5 M17 16V9',
  pin:'M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0z M14 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0z',
  upload:'M12 16V3 M7 8l5-5 5 5 M4 15v5h16v-5',
  check:'m4 12 5 5L20 6',
  arrow:'M4 12h16 m-6-6 6 6-6 6',
  box:'m3 7 9-5 9 5v10l-9 5-9-5z M3 7l9 5 9-5 M12 12v10 M8 4l9 5',
  scan:'M3 8V3h5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5 M7 8v8 M10 8v8 M14 8v8 M17 8v8'
} as const;
export type IconName = keyof typeof paths;
export function Icon({name,size=21}:{name:IconName;size?:number}) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>;
}
