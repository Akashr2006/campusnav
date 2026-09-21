export async function cookies() {
  const store = new Map<string, string>();
  return {
    get: (key: string) => {
      const val = store.get(key);
      return val ? { name: key, value: val } : undefined;
    },
    set: (key: string, value: string) => {
      store.set(key, value);
    },
    delete: (key: string) => {
      store.delete(key);
    },
  };
}
