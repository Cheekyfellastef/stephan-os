import { graphStore } from './graphStore.js';
import {
  createEdgeId,
  createNodeId,
  sanitizeEdgeInput,
  sanitizeNodeInput,
} from './graphTypes.js';

function includesText(value = '', query = '') {
  return String(value).toLowerCase().includes(String(query).toLowerCase());
}

class KnowledgeGraphService {
  listNodes() {
    return graphStore.readNodes();
  }

  listEdges() {
    return graphStore.readEdges();
  }

  getNode(id) {
    return this.listNodes().find((node) => node.id === id) ?? null;
  }

  hasDuplicateNode(nodes, candidate) {
    return nodes.some((node) => (
      node.label.toLowerCase() === candidate.label.toLowerCase()
      && node.type === candidate.type
    ));
  }

  createNode(input = {}) {
    const clean = sanitizeNodeInput(input);
    if (!clean.label) {
      throw new Error('Node label is required.');
    }

    const nodes = this.listNodes();
    if (this.hasDuplicateNode(nodes, clean)) {
      throw new Error(`Node '${clean.label}' already exists for type '${clean.type}'.`);
    }

    const now = new Date().toISOString();
    const node = {
      id: input.id ?? createNodeId(),
      label: clean.label,
      type: clean.type,
      description: clean.description,
      tags: clean.tags,
      created_at: now,
      updated_at: now,
      source: clean.source,
      metadata: clean.metadata,
      confidence: input.confidence ?? null,
      provenance: input.provenance ?? null,
      embedding_ref: input.embedding_ref ?? null,
    };

    graphStore.writeNodes([...nodes, node]);
    return node;
  }

  updateNode(id, patch = {}) {
    const cleanPatch = sanitizeNodeInput({ ...this.getNode(id), ...patch });
    const nodes = this.listNodes();
    const index = nodes.findIndex((node) => node.id === id);

    if (index < 0) {
      throw new Error(`Node '${id}' was not found.`);
    }

    const existing = nodes[index];
    const updated = {
      ...existing,
      ...cleanPatch,
      id,
      updated_at: new Date().toISOString(),
    };

    nodes[index] = updated;
    graphStore.writeNodes(nodes);
    return updated;
  }

  deleteNode(id) {
    const nodes = this.listNodes();
    if (!nodes.some((node) => node.id === id)) {
      throw new Error(`Node '${id}' was not found.`);
    }

    const nextNodes = nodes.filter((node) => node.id !== id);
    const edges = this.listEdges();
    const nextEdges = edges.filter((edge) => edge.from !== id && edge.to !== id);
    graphStore.writeNodes(nextNodes);
    graphStore.writeEdges(nextEdges);

    return {
      deleted_node_id: id,
      removed_edge_count: edges.length - nextEdges.length,
    };
  }

  hasDuplicateEdge(edges, candidate) {
    return edges.some((edge) => (
      edge.from === candidate.from
      && edge.to === candidate.to
      && edge.type === candidate.type
      && edge.label === candidate.label
    ));
  }

  createEdge(input = {}) {
    const clean = sanitizeEdgeInput(input);
    if (!clean.from || !clean.to) {
      throw new Error('Edge requires both from and to node IDs.');
    }
    if (clean.from === clean.to) {
      throw new Error('Self-referencing edges are not allowed for this milestone.');
    }

    const nodes = this.listNodes();
    if (!nodes.some((node) => node.id === clean.from)) {
      throw new Error(`Cannot create edge: source node '${clean.from}' does not exist.`);
    }
    if (!nodes.some((node) => node.id === clean.to)) {
      throw new Error(`Cannot create edge: target node '${clean.to}' does not exist.`);
    }

    const edges = this.listEdges();
    if (this.hasDuplicateEdge(edges, clean)) {
      throw new Error('Duplicate edge detected; same from/to/type/label already exists.');
    }

    const now = new Date().toISOString();
    const edge = {
      id: input.id ?? createEdgeId(),
      from: clean.from,
      to: clean.to,
      type: clean.type,
      label: clean.label,
      weight: clean.weight,
      created_at: now,
      updated_at: now,
      metadata: clean.metadata,
      confidence: input.confidence ?? null,
      provenance: input.provenance ?? null,
    };

    graphStore.writeEdges([...edges, edge]);
    return edge;
  }

  deleteEdge(id) {
    const edges = this.listEdges();
    if (!edges.some((edge) => edge.id === id)) {
      throw new Error(`Edge '${id}' was not found.`);
    }

    graphStore.writeEdges(edges.filter((edge) => edge.id !== id));
    return { deleted_edge_id: id };
  }

  searchGraph(query = '') {
    const normalized = String(query).trim().toLowerCase();
    if (!normalized) {
      throw new Error('Search query cannot be empty.');
    }

    const nodes = this.listNodes();
    const edges = this.listEdges();

    const node_matches = nodes.filter((node) => (
      includesText(node.label, normalized)
      || includesText(node.description, normalized)
      || node.tags.some((tag) => includesText(tag, normalized))
      || includesText(node.type, normalized)
    ));

    const edge_matches = edges.filter((edge) => (
      includesText(edge.label, normalized)
      || includesText(edge.type, normalized)
    ));

    return { query, node_matches, edge_matches };
  }

  findRelatedNodes(nodeId) {
    const node = this.getNode(nodeId);
    if (!node) {
      throw new Error(`Node '${nodeId}' was not found.`);
    }

    const nodes = this.listNodes();
    const edges = this.listEdges().filter((edge) => edge.from === nodeId || edge.to === nodeId);

    const related = edges.map((edge) => {
      const relatedId = edge.from === nodeId ? edge.to : edge.from;
      return {
        edge,
        node: nodes.find((candidate) => candidate.id === relatedId) ?? null,
      };
    }).filter((entry) => entry.node);

    return { node, related };
  }

  getGraphStats() {
    const nodes = this.listNodes();
    const edges = this.listEdges();

    const node_types = nodes.reduce((acc, node) => {
      acc[node.type] = (acc[node.type] ?? 0) + 1;
      return acc;
    }, {});

    const edge_types = edges.reduce((acc, edge) => {
      acc[edge.type] = (acc[edge.type] ?? 0) + 1;
      return acc;
    }, {});

    const tags = [...new Set(nodes.flatMap((node) => node.tags || []))].sort();

    return {
      totals: {
        nodes: nodes.length,
        edges: edges.length,
        tags: tags.length,
      },
      node_types,
      edge_types,
      tags,
      recent_nodes: [...nodes].slice(-5).reverse(),
      recent_edges: [...edges].slice(-5).reverse(),
    };
  }

  getStatus() {
    return {
      service: 'knowledge_graph',
      ...graphStore.getStatus(),
      stats: this.getGraphStats().totals,
    };
  }
}

export const knowledgeGraphService = new KnowledgeGraphService();
