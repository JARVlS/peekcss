export const INSPECTOR_PORT = 'peekcss:inspector';

export interface InspectionData {
  selector: { tag: string; id: string | null; classes: string[] };
  dimensions: { width: number; height: number };
  typography: {
    fontFamily: string;
    fontSize: string;
    fontWeight: string;
    lineHeight: string;
    letterSpacing: string;
    color: string;
  };
  box: { padding: string; margin: string; border: string; borderRadius: string };
  background: { color: string; image: string };
  layout: { display: string; position: string };
  effects: { boxShadow: string; opacity: string };
}

// Discriminated union → adding a new message kind forces both sides
// to handle it. Keeps stringly-typed bugs out.
export type InspectorMessage =
  | { kind: 'update'; data: InspectionData }
  | { kind: 'cleared' };
