import { mountDashboard } from './dashboard';
import './styles.css';

declare const __DIVBAND_API_BASE_URL__: string | undefined;

const root = document.querySelector<HTMLElement>('#app');
const apiBaseUrl = typeof __DIVBAND_API_BASE_URL__ === 'string' && __DIVBAND_API_BASE_URL__.length > 0
  ? __DIVBAND_API_BASE_URL__
  : '/api';

if (!root) {
  throw new Error('Dashboard root element #app was not found.');
}

mountDashboard({
  root,
  baseUrl: apiBaseUrl,
});
