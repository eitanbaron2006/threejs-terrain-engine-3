function finite(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

export class HabitatStream {
  constructor({ activationRadius = 220, releaseRadius = 280 } = {}) {
    this.activationRadius = Math.max(1, finite(activationRadius, 220));
    this.releaseRadius = Math.max(
      this.activationRadius,
      finite(releaseRadius, 280),
    );
    this.zones = [];
    this.zoneById = new Map();
    this.active = new Set();
  }

  setLayout(layout) {
    this.zones = [...(layout?.zones ?? [])];
    this.zoneById = new Map(this.zones.map((zone) => [zone.id, zone]));
    for (const id of [...this.active]) {
      if (!this.zoneById.has(id)) this.active.delete(id);
    }
  }

  activate(id) {
    if (!this.zoneById.has(id)) return false;
    this.active.add(id);
    return true;
  }

  update(focus) {
    const x = finite(focus?.x, 0);
    const z = finite(focus?.z, 0);
    const activated = [];
    const released = [];

    for (const zone of this.zones) {
      const distance = Math.hypot(zone.x - x, zone.z - z);
      if (!this.active.has(zone.id) && distance <= this.activationRadius) {
        this.active.add(zone.id);
        activated.push(zone.id);
      } else if (this.active.has(zone.id) && distance > this.releaseRadius) {
        this.active.delete(zone.id);
        released.push(zone.id);
      }
    }

    return {
      activated,
      released,
      active: this.activeIds,
    };
  }

  get activeIds() {
    return this.zones
      .filter((zone) => this.active.has(zone.id))
      .map((zone) => zone.id);
  }
}
