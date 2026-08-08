import { selectBootstrap } from './app/bootstrapHost';

const host = selectBootstrap(import.meta.env.VITE_APP_HOST);
void (host === 'android' ? import('./main.android') : import('./main.web'));
