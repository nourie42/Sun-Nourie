<script>
let map;

function initMap() {
  map = new google.maps.Map(document.getElementById("map"), {
    center: { lat: 35.7796, lng: -78.6382 }, // default Raleigh, NC
    zoom: 12,
  });
}

// Example: search nearby gas stations
async function searchNearby(lat, lng) {
  const resp = await fetch(`/places?lat=${lat}&lng=${lng}&radius=1609`);
  const data = await resp.json();

  data.results.forEach(place => {
    new google.maps.Marker({
      position: place.geometry.location,
      map,
      title: place.name
    });
  });
}
</script>


