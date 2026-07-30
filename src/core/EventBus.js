export class EventBus {
  #listeners = new Map();

  on(eventName, listener) {
    const listeners = this.#listeners.get(eventName) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(eventName, listeners);
    return () => listeners.delete(listener);
  }

  emit(eventName, payload) {
    for (const listener of this.#listeners.get(eventName) ?? []) {
      listener(payload);
    }
  }

  clear() {
    this.#listeners.clear();
  }
}
