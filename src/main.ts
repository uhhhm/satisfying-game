import './style.css';
import { Game } from './game/game';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const game = new Game(canvas);
(window as any).__game = game;
game.start();
