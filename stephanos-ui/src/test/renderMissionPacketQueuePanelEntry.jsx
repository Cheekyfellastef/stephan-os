import { renderToStaticMarkup } from 'react-dom/server';
import MissionPacketQueuePanel from '../components/MissionPacketQueuePanel.jsx';

export function renderMissionPacketQueuePanel() {
  return renderToStaticMarkup(<MissionPacketQueuePanel />);
}
