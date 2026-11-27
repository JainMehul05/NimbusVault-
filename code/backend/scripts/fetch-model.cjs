/** Downloads the embedding model into a directory (image build) and proves it loads offline. */
const [model, dir] = process.argv.slice(2);

(async () => {
  const transformers = require('@huggingface/transformers');
  transformers.env.cacheDir = dir;
  await transformers.pipeline('feature-extraction', model, { dtype: 'fp32' });

  transformers.env.allowRemoteModels = false;
  transformers.env.localModelPath = dir;
  const extractor = await transformers.pipeline('feature-extraction', model, { dtype: 'fp32' });
  const out = await extractor(['hello'], { pooling: 'mean', normalize: true });
  console.log(`${model}: ${out.dims.at(-1)} dimensions, loads offline from ${dir}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
