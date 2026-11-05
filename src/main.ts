import './style.css';
import { Game } from './game/game';
import { CFG } from './core/config';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const game = new Game(canvas);
// handy for tinkering from the console
(window as any).__game = game;
(window as any).__cfg = CFG;
game.start();
