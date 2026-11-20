import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ConversationCanvasCard from '../components/ConversationCanvasCard.jsx';

export function renderConversationCanvasCard(view) {
  return renderToStaticMarkup(<ConversationCanvasCard view={view} />);
}
