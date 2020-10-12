#!/usr/bin/env -S yarn node

const tileReduce = require('@mapbox/tile-reduce');
const path = require('path');

const inputPbf = process.argv[2];

let addresses = [];

tileReduce({
  zoom: 12,
  map: path.join(__dirname, '/process-tile.js'),
  sources: [
    {
      name: 'osm',
      mbtiles: path.resolve(inputPbf),
      raw: true
    }
  ]
}).on('reduce', (result, tile) => {
  addresses = addresses.concat(result.addresses);
}).on('end', () => {
  addresses.forEach((address) => {
    if (true) { // (address["addr:street"] && address["addr:housenumber"] && (address["addr:unit"] || address.ref))
      const units = (address.ref || address["addr:unit"] || "");
      units.split(';').forEach((unit) => {
        const url = address["@id"] && "https://www.openstreetmap.org/" + address["@type"] + "/" + address["@id"] || ""
        console.log(`${address["addr:street"]}|${address["addr:housenumber"]}|${unit}|${address.entrance || address.building}|${url}`);
      });
    }
  });
  console.error('Number of entries', addresses.length);
});
