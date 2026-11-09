import './style.css';
import { Game } from './game/Game';

const container = document.getElementById('game-container');
if (container) {
  const game = new Game(container);
  game.start();
}
