export interface SectionDef {
  id: 'problem' | 'how-ce-decides' | 'sample-report' | 'quick-start';
  title: string;
}

export const SECTIONS: readonly SectionDef[] = [
  { id: 'problem', title: 'Problem' },
  { id: 'how-ce-decides', title: 'How CE decides' },
  { id: 'sample-report', title: 'Sample report' },
  { id: 'quick-start', title: 'Quick start' },
];
