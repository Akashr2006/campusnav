async function fetchGraph() {
  try {
    const res = await fetch("http://localhost:3000/api/published-graph");
    const data = await res.json();
    console.log("Nodes currently returned from /api/published-graph:");
    if (data.published && data.published.nodes && data.published.nodes.length > 0) {
      data.published.nodes.forEach(n => {
        console.log(`ID: ${n.id}, Name: ${n.name || 'N/A'}, X: ${n.x}, Y: ${n.y}, FloorId: ${n.floorId}, Lat: ${n.lat || 'N/A'}, Lng: ${n.lng || 'N/A'}`);
      });
    } else {
      console.log("Empty nodes array or null data returned.");
      console.log(JSON.stringify(data).substring(0, 500));
    }
  } catch (err) {
    console.error("Fetch failed:", err.message);
  }
}
fetchGraph();
