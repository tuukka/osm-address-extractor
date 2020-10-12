
const boxIntersect = require('box-intersect');

// From https://wrf.ecse.rpi.edu//Research/Short_Notes/pnpoly.html
function pointInPolygon(point, polygon) {
  var testx = point[0], testy = point[1];
  var inside = false;
  for (var i = 0, j = polygon.length-1; i < polygon.length; j = i++) {
    if ( ((polygon[i].y>testy) != (polygon[j].y>testy)) &&
	 (testx < (polygon[j].x-polygon[i].x) * (testy-polygon[i].y) / (polygon[j].y-polygon[i].y) + polygon[i].x) )
      inside = !inside;
  }
  return inside;
}

function pointInMultipolygon(point, multipolygon) {
  var inside = false;
  for (var i = 0; i < multipolygon.length; i++) {
    if (pointInPolygon(point, multipolygon[i])) {
      inside = !inside; // If we were inside, we are now outside (in a hole)
    }
  }
  return inside;
}

function vertexOfPolygon(point, polygon) {
  for (var i = 0; i < polygon.length; i++) {
    if (polygon[i].x === point[0] && polygon[i].y === point[1]) {
      return true;
    }
  }
  return false;
}

function vertexOfMultipolygon(point, multipolygon) {
  for (var i = 0; i < multipolygon.length; i++) {
    if (vertexOfPolygon(point, multipolygon[i])) {
      return true;
    }
  }
  return false;
}

module.exports = (data, xyz, writeData, done) => {
  let building2addresses = {};
  let result = [];

  let entrance_bboxes = [];
  let entrances = [];
  let building_bboxes = [];
  let building_features = [];
  let buildings = [];
  let housenumber_bboxes = [];
  let housenumbers = [];
  for (var i = 0; i < data.osm.osm.length; i++) {
    var ft = data.osm.osm.feature(i);
    if (ft.properties.entrance) {
      entrances.push(ft.properties);
      entrance_bboxes.push(ft.bbox());
    } else if (ft.properties.building) {
      buildings.push(ft.properties);
      building_bboxes.push(ft.bbox());
      building_features.push(ft);
    } else if (ft.properties["addr:housenumber"] && !ft.properties["amenity"] && !ft.properties["craft"] && !ft.properties["leisure"] && !ft.properties["office"] && !ft.properties["shop"] && !ft.properties["tourism"]) { // XXX not exhaustive
      housenumbers.push(ft.properties);
      housenumber_bboxes.push(ft.bbox());
    }
  }

  // Populate building2addresses
  boxIntersect(building_bboxes, housenumber_bboxes, function (i, j) {
    const building = buildings[i];
    const housenumber = housenumbers[j];

    if (!pointInMultipolygon(housenumber_bboxes[j], building_features[i].loadGeometry()) &&
        !vertexOfPolygon(housenumber_bboxes[j], building_features[i].loadGeometry())) {
      return; // boxIntersect gave a false positive
    }

    // FIXME @id is unique only with @type
    const oldlist = building2addresses[building["@id"]] || [];
    building2addresses[building["@id"]] = oldlist.concat([housenumber]);
  });

  // Clean up building2addresses (remove duplicates)
  buildings.forEach((building) => {
    let addresses = building2addresses[building["@id"]];
    if (!addresses) {
      return;
    }
    const seen = {};
    seen[`${building["addr:street"]} ${building["addr:housenumber"]}`] = true;
    building2addresses[building["@id"]] = addresses = addresses.filter((address) => {
      const key = `${address["addr:street"]} ${address["addr:housenumber"]}`;
      if (seen[key]) {
        return false;
      }
      seen[key] = true;
      return true;
    });

    if (false) { // If we want to make the only alternatives the main addresses
      if (addresses.length == 1 && (!building["addr:housenumber"] || !building["addr:street"])) {
        // Make the only alternative the main address
        building["addr:housenumber"] = addresses[0]["addr:housenumber"];
        building["addr:street"] = addresses[0]["addr:street"];
        // XXX addr:unit too?

        delete building2addresses[building["@id"]];
      }
    }

    result.push(building);
    building2addresses[building["@id"]].forEach((address) => {
      result.push({
        address: "auxiliary",
        building: building.building,
        "addr:street": address["addr:street"],
        "addr:housenumber": address["addr:housenumber"],
        "addr:unit": building["addr:unit"],
        ref: building.ref,
      });
    });
  });

  // Populate result
  boxIntersect(building_bboxes, entrance_bboxes, function (i, j) {
    const building = buildings[i];
    const entrance = entrances[j];

    if (!vertexOfMultipolygon(entrance_bboxes[j], building_features[i].loadGeometry()) &&
        !pointInMultipolygon(entrance_bboxes[j], building_features[i].loadGeometry())
    ) {
      return; // boxIntersect gave a false positive
    }

    // Copy information from the building to the entrance if needed
    if (!entrance["addr:housenumber"] || !entrance["addr:street"]) {
      entrance["addr:housenumber"] = building["addr:housenumber"];
      entrance["addr:street"] = building["addr:street"];

      // Further, copy unit information
      if (!entrance["addr:unit"] && !entrance.ref) {
        entrance["addr:unit"] = building["addr:unit"];
        entrance.ref = building.ref;
      }
    }

    result.push(entrance);

    let addresses = building2addresses[building["@id"]] || [];
    if (building["addr:street"] && building["addr:housenumber"]) {
      // Add the main address of the building as an alternative address of the entrance
      addresses = addresses.concat([building]);
    }

    // Duplicate the entrance in the results for each alternative address
    addresses.forEach((address) => {
      if (address["addr:street"] == entrance["addr:street"] && address["addr:housenumber"] == entrance["addr:housenumber"]) {
        return; // Don't duplicate the main address
      }
      result.push({
        address: "auxiliary",
        entrance: entrance.entrance,
        "addr:street": address["addr:street"],
        "addr:housenumber": address["addr:housenumber"],
        "addr:unit": entrance["addr:unit"],
        ref: entrance.ref,
      });
    });
  });

  done(null, {
    addresses: [].concat(result, buildings) // XXX buildings and entrances outside buildings too?
  });
};
