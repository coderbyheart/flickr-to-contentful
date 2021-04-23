import contentfulManagement from "contentful-management";
import Bottleneck from "bottleneck";
import path from "path";
import w3wapi from "@what3words/api";
w3wapi.setOptions({ key: process.env.W3W_API_KEY });
import { promises as fs, createReadStream } from "fs";
const limiter = new Bottleneck({
  minTime: 1000 / 5,
  maxConcurrent: 5,
});

const cfM = contentfulManagement.createClient({
  accessToken: process.env.CONTENTFUL_MANAGEMENT_API_TOKEN,
});

const env = await limiter
  .schedule(() => cfM.getSpace(process.env.CONTENTFUL_SPACE))
  .then((space) => limiter.schedule(() => space.getEnvironments()))
  .then((res) => res.items[0]);

const toFloat = (s) =>
  parseFloat(`${s.substr(0, s.length - 6)}.${s.substr(s.length - 6, 6)}`);

const toW3W = async (geo) => {
  if (geo.length === 0) return;
  const l = await w3wapi.convertTo3wa({
    lat: toFloat(geo[0].latitude),
    lng: toFloat(geo[0].longitude),
  });
  return `///${l.words}`;
};

const uploadImage = (dataDir) => async (img) => {
  const f = path.parse(img);
  const p = f.name.split("_").filter((s) => /^[0-9]+$/.test(s));
  let id = p[p.length - 1];
  const meta = JSON.parse(
    await fs.readFile(path.join(dataDir, `photo_${id}.json`), "utf-8")
  );

  if (meta.privacy !== "public") {
    console.log(`Image is ${meta.privacy}: ${img}`);
    return;
  }

  // Create asset
  const fileInfo = {
    title: {
      "en-US": `flickr/${meta.id}`,
    },
    description: {
      "en-US": [
        meta.name,
        meta.description,
        meta.tags.map(({ tag }) => `#${tag}`).join(" "),
        await toW3W(meta.geo),
        `License: ${meta.license}`,
      ].join("\n"),
    },
  };

  let contentType = "image/jpeg";
  if (/\.png$/i.test(f.ext)) contentType = "image/png";
  if (/\.gif$/i.test(f.ext)) contentType = "image/gif";
  const assetDraft = await limiter.schedule(() =>
    env.createAssetFromFiles({
      fields: {
        ...fileInfo,
        file: {
          "en-US": {
            contentType,
            fileName: f.name,
            file: createReadStream(img),
          },
        },
      },
    })
  );
  const readyAsset = await limiter.schedule(() =>
    assetDraft.processForAllLocales()
  );
  const asset = await limiter.schedule(() => readyAsset.publish());
  console.log(asset);
};

const u = uploadImage("/home/m/Downloads/flickr/data/");
const main = async () => {
  const files = (await fs.readFile("/dev/stdin", "utf-8"))
    .split("\n")
    .filter((f) => f.length > 0);
  await files.reduce(
    (p, f) =>
      p.then(async () => {
        try {
          console.log(f);
          await u(f);
        } catch (err) {
          console.error(err);
        }
      }),
    Promise.resolve()
  );
};

main();
