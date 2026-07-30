export class TerrainHistory {
  constructor(limit = 20) {
    this.limit = limit;
    this.undoStack = [];
    this.redoStack = [];
  }

  push(command) {
    this.undoStack.push(command);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo(world) {
    const command = this.undoStack.pop();
    if (!command) return false;
    world.restoreEditableState(command.before);
    this.redoStack.push(command);
    return true;
  }

  redo(world) {
    const command = this.redoStack.pop();
    if (!command) return false;
    world.restoreEditableState(command.after);
    this.undoStack.push(command);
    return true;
  }

  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }
}
