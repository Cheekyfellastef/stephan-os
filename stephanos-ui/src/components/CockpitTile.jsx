import CockpitSummaryView from './CockpitSummaryView.jsx';
export default function CockpitTile({ projection, onOpenCockpit } = {}) {
  return <CockpitSummaryView projection={projection} compact onOpenCockpit={onOpenCockpit} />;
}
