// Generation limits complement, never replace, the source mutation validator.
// A truncated response is still rejected by the streaming transport.
export const LOCAL_BUILDER_OUTPUT_TOKENS_V1 = 8192;

export function createLocalBuilderModelRequestV1({model, prompt, patchFallbackAllowed = false}) {
  const edits = {
    type: 'object', additionalProperties: false, required: ['edits', 'summary'],
    properties: {
      edits: {type: 'array', minItems: 1, maxItems: 64, items: {
        type: 'object', additionalProperties: false, required: ['path', 'old', 'new'],
        properties: {path: {type: 'string'}, old: {type: 'string'}, new: {type: 'string'}},
      }},
      summary: {type: 'string', maxLength: 512},
    },
  };
  const patch = {
    type: 'object', additionalProperties: false, required: ['patch', 'summary'],
    properties: {patch: {type: 'string'}, summary: {type: 'string', maxLength: 512}},
  };
  return {
    model,
    format: patchFallbackAllowed ? {anyOf: [edits, patch]} : edits,
    messages: [{role: 'user', content: prompt}],
    options: {temperature: 0, num_predict: LOCAL_BUILDER_OUTPUT_TOKENS_V1},
  };
}
