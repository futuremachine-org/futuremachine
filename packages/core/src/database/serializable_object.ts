import type { SerializableObjectBranding } from '../symbols.js';

export interface SerializableObject {
  // Needed so that implementers have to implement SerializableObject.
  readonly [SerializableObjectBranding]: void;
}
