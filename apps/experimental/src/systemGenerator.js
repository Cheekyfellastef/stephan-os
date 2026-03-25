function makeFileStub(layer, part) {
  return {
    path: `${layer}/${part}.js`,
    summary: `Generated stub for ${layer}::${part}`,
    api: {
      method: 'POST',
      contract: `/api/${layer}/${part}`
    }
  };
}

export function generateSystemStructure(decomposition) {
  const folders = [];
  const files = [];
  const apis = [];

  decomposition.layers.forEach((layerNode) => {
    folders.push(layerNode.layer);

    layerNode.responsibilities.forEach((part) => {
      const stub = makeFileStub(layerNode.layer, part);
      files.push(stub);
      apis.push({
        layer: layerNode.layer,
        endpoint: stub.api.contract,
        method: stub.api.method,
        purpose: part
      });
    });
  });

  return {
    generatedAt: new Date().toISOString(),
    iteration: decomposition.iteration,
    folders,
    files,
    apis,
    uiLayout: {
      shell: 'command-deck',
      regions: ['intent', 'decomposition', 'generation', 'simulation', 'evaluation', 'iteration']
    }
  };
}
