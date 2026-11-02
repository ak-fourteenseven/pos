/** @type {import('tailwindcss').Config} */
import preset from '../shared/tailwind-preset.js';

export default {
  content: ['./index.html', './src/**/*.{vue,js}', '../shared/**/*.{vue,js}'],
  ...preset,
};
