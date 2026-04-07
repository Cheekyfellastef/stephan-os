import { renderToStaticMarkup } from 'react-dom/server';
import HomeBridgePanel from '../components/HomeBridgePanel.jsx';

export function renderHomeBridgePanel() {
  return renderToStaticMarkup(<HomeBridgePanel />);
}
