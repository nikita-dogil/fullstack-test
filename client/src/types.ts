export interface Page {
  items: number[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export interface AppState {
  selectedOrder: number[];
  selectedCount: number;
  customCount: number;
  universeSize: number;
  baseMax: number;
}
