export class WeakCache<K, V extends WeakKey> {
  private map: Map<K, WeakRef<V>> = new Map();
  private registry: FinalizationRegistry<K> = new FinalizationRegistry(
    (key: K) => {
      this.map.delete(key);
    }
  );

  public size() {
    return this.map.size;
  }

  public set(key: K, value: V) {
    this.map.set(key, new WeakRef(value));
    this.registry.register(value, key);
  }

  public get(key: K): V | undefined {
    return this.map.get(key)?.deref();
  }
}
