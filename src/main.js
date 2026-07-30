import { TerrainEditorApp } from './app/TerrainEditorApp.js';

const root = document.querySelector('#app');
const app = new TerrainEditorApp(root);

app.start().catch((error) => {
  console.error(error);
  root.innerHTML = `<div class="fatal-error"><h1>שגיאה בהפעלת העורך</h1><pre>${error.message}</pre></div>`;
});
