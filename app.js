// Етап 1: Ініціалізація та налаштування базової карти
const map = L.map('map').setView([49.84, 24.02], 12);

const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

// Шари, які будуть додані в LayerControl
let muoMarkers = L.layerGroup().addTo(map);
let heatLayerDensity = L.layerGroup();
let heatLayerHeight = L.layerGroup();
let osmCluster = L.markerClusterGroup().addTo(map);
let choroplethLayer = L.layerGroup();

// Ініціалізація LayerControl (Етап 6)
const baseMaps = {
    "OSM (Базова карта)": osmLayer
};

const overlayMaps = {
    "Об'єкти МУО (Маркери)": muoMarkers,
    "Теплова карта (Щільність забудови)": heatLayerDensity,
    "Теплова карта (Висота забудови)": heatLayerHeight,
    "Інфраструктура (Overpass)": osmCluster,
    "МУО по районах (Хороплет)": choroplethLayer
};

const layerControl = L.control.layers(baseMaps, overlayMaps, { collapsed: false }).addTo(map);

// Функція для визначення інтенсивності для теплової карти (Висота)
function calculateHeightIntensity(feature) {
    let intensity = 0.2; // Базова мінімальна інтенсивність
    let maxHeight = 0;

    if (feature.properties.conditions_json && Array.isArray(feature.properties.conditions_json)) {
        feature.properties.conditions_json.forEach(cond => {
            if (cond && cond.cond_value && !isNaN(parseFloat(cond.cond_value))) {
                const val = parseFloat(cond.cond_value);
                if (val > maxHeight && val < 200) maxHeight = val;
            }
            if (cond && cond.note) {
                const noteStr = String(cond.note).toLowerCase();
                const heightRegex = /(\d+[\.,]?\d*)\s*(м|метрів)/g;
                let match;
                while ((match = heightRegex.exec(noteStr)) !== null) {
                    const heightValue = parseFloat(match[1].replace(',', '.'));
                    if (!isNaN(heightValue) && heightValue >= 3 && heightValue <= 200 && heightValue > maxHeight) {
                        const contextStart = Math.max(0, match.index - 30);
                        const context = noteStr.substring(contextStart, match.index);
                        if (!context.includes('відстань') && !context.includes('відступ') && !context.includes('межі')) {
                            maxHeight = heightValue;
                        }
                    }
                }
            }
        });
    }

    if (maxHeight > 0) {
        intensity += (maxHeight / 100) * 0.8; 
    } else {
        intensity = 0.3;
    }
    return Math.min(intensity, 1.0);
}

// Функція для визначення інтенсивності для теплової карти (Щільність забудови)
function calculateDensityIntensity(feature) {
    let intensity = 0.5; // Базова інтенсивність
    if (feature.properties.conditions_json && Array.isArray(feature.properties.conditions_json)) {
        feature.properties.conditions_json.forEach(cond => {
            if (cond && cond.note) {
                const noteLower = String(cond.note).toLowerCase();
                if (noteLower.includes('відсоток забудови') || noteLower.includes('%') || noteLower.includes('щільність')) {
                    intensity += 0.3; // Збільшуємо інтенсивність
                }
            }
        });
    }
    return Math.min(intensity, 1.0);
}

// Завантаження даних МУО
fetch('data/registermuo01052026.geojson')
    .then(response => response.json())
    .then(data => {
        // Етап 2: Завантаження та парсинг датасету
        
        // Масиви для теплової карти
        const heatDataDensity = [];
        const heatDataHeight = [];
        
        // Додаємо GeoJSON на карту
        const geoJsonLayer = L.geoJSON(data, {
            onEachFeature: (feature, layer) => {
                // Попап (Етап 2.4)
                let popupHtml = `<div class="popup-content">`;
                if (feature.properties.doc_name) {
                    popupHtml += `<h3>${feature.properties.doc_name}</h3>`;
                }
                
                if (feature.properties.conditions_json && Array.isArray(feature.properties.conditions_json)) {
                    feature.properties.conditions_json.forEach(cond => {
                        if (cond.note) {
                            popupHtml += `<div class="condition-note">${cond.note}</div>`;
                        }
                    });
                }
                popupHtml += `</div>`;
                layer.bindPopup(popupHtml);
                
                // Збираємо координати для теплових карт
                if (feature.geometry && feature.geometry.type === 'Point') {
                    const [lon, lat] = feature.geometry.coordinates;
                    heatDataDensity.push([lat, lon, calculateDensityIntensity(feature)]);
                    heatDataHeight.push([lat, lon, calculateHeightIntensity(feature)]);
                } else if (feature.geometry && (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon')) {
                    try {
                        const center = turf.center(feature);
                        const [lon, lat] = center.geometry.coordinates;
                        heatDataDensity.push([lat, lon, calculateDensityIntensity(feature)]);
                        heatDataHeight.push([lat, lon, calculateHeightIntensity(feature)]);
                    } catch (e) {
                        console.log("Error calculating center", e);
                    }
                }
            }
        });
        
        muoMarkers.addLayer(geoJsonLayer);
        
        // Етап 3: Побудова теплових карт
        const actualHeatLayerDensity = L.heatLayer(heatDataDensity, { radius: 25, blur: 15 });
        const actualHeatLayerHeight = L.heatLayer(heatDataHeight, { radius: 25, blur: 15, gradient: {0.4: 'purple', 0.65: 'orange', 1: 'yellow'} });
        
        layerControl.removeLayer(heatLayerDensity);
        layerControl.removeLayer(heatLayerHeight);
        
        heatLayerDensity = actualHeatLayerDensity;
        heatLayerHeight = actualHeatLayerHeight;
        
        layerControl.addOverlay(heatLayerDensity, "Теплова карта (Щільність забудови)");
        layerControl.addOverlay(heatLayerHeight, "Теплова карта (Висота забудови)");
        
        // Етап 4: Інтеграція Overpass API
        loadOverpassData(data);
        
        // Етап 5: Хороплетна карта
        loadChoropleth(data);
    })
    .catch(error => {
        console.error('Помилка завантаження датасету МУО:', error);
    });

// Етап 4: Інтеграція Overpass API
function loadOverpassData(muoData) {
    try {
        // 4.1 Генерація Bounding Box
        const bbox = turf.bbox(muoData); 
        // bbox format: [minLon, minLat, maxLon, maxLat]
        
        // Overpass очікує: (minLat, minLon, maxLat, maxLon)
        const bboxString = `${bbox[1]},${bbox[0]},${bbox[3]},${bbox[2]}`;
        
        // 4.2 Формування запиту Overpass QL
        const query = `
            [out:json][timeout:25];
            (
              node["amenity"="cafe"](${bboxString});
              node["amenity"="pharmacy"](${bboxString});
              node["leisure"="park"](${bboxString});
            );
            out body;
            >;
            out skel qt;
        `;
        
        // 4.3 Асинхронний запит
        fetch('https://overpass-api.de/api/interpreter', {
            method: 'POST',
            body: query
        })
        .then(response => response.json())
        .then(data => {
            // 4.4 Кластеризація (MarkerCluster)
            data.elements.forEach(element => {
                if (element.type === 'node') {
                    let iconEmoji = '📍';
                    let title = 'Об\'єкт';
                    
                    if (element.tags) {
                        if (element.tags.amenity === 'cafe') {
                            iconEmoji = '☕';
                            title = element.tags.name || 'Кафе';
                        } else if (element.tags.amenity === 'pharmacy') {
                            iconEmoji = '➕';
                            title = element.tags.name || 'Аптека';
                        } else if (element.tags.leisure === 'park') {
                            iconEmoji = '🌳';
                            title = element.tags.name || 'Парк';
                        }
                    }
                    
                    const customIcon = L.divIcon({
                        className: 'custom-div-icon',
                        html: `<div class="icon-wrapper" title="${title}">${iconEmoji}</div>`,
                        iconSize: [24, 24],
                        iconAnchor: [12, 12]
                    });
                    
                    const marker = L.marker([element.lat, element.lon], { icon: customIcon });
                    marker.bindPopup(`<b>${title}</b><br>${element.tags ? JSON.stringify(element.tags) : ''}`);
                    osmCluster.addLayer(marker);
                }
            });
            console.log(`Додано ${data.elements.length} об'єктів інфраструктури.`);
        })
        .catch(err => console.error("Помилка Overpass API:", err));
        
    } catch (e) {
        console.error("Помилка при генерації BBox або запиту Overpass:", e);
    }
}

// Етап 5: Хороплетна карта
function loadChoropleth(muoData) {
    // Отримуємо межі районів/громад з локального файлу
    fetch('data/communities.json')
    .then(response => response.json())
    .then(geojsonDistricts => {
        
        // 5.2 Просторове злиття (Point-in-Polygon)
        const muoPoints = [];
        turf.featureEach(muoData, (currentFeature) => {
            if (currentFeature.geometry && currentFeature.geometry.type === 'Point') {
                muoPoints.push(currentFeature);
            } else if (currentFeature.geometry) {
                try {
                    muoPoints.push(turf.center(currentFeature));
                } catch(e) {}
            }
        });
        const pointsCollection = turf.featureCollection(muoPoints);
        
        // Підрахунок точок в кожному полігоні
        turf.featureEach(geojsonDistricts, (district) => {
            if (district.geometry && (district.geometry.type === 'Polygon' || district.geometry.type === 'MultiPolygon')) {
                const ptsWithin = turf.pointsWithinPolygon(pointsCollection, district);
                district.properties.muoCount = ptsWithin.features.length;
            } else {
                district.properties.muoCount = 0;
            }
        });
        
        // 5.3 Стилізація полігонів
        function getColor(d) {
            return d > 100 ? '#800026' :
                   d > 50  ? '#BD0026' :
                   d > 20  ? '#E31A1C' :
                   d > 10  ? '#FC4E2A' :
                   d > 5   ? '#FD8D3C' :
                   d > 0   ? '#FEB24C' :
                             '#FFEDA0';
        }
        
        function style(feature) {
            return {
                fillColor: getColor(feature.properties.muoCount),
                weight: 2,
                opacity: 1,
                color: 'white',
                dashArray: '3',
                fillOpacity: 0.7
            };
        }
        
        // 5.4 Рендеринг хороплету
        const districtsLayer = L.geoJSON(geojsonDistricts, {
            style: style,
            onEachFeature: (feature, layer) => {
                const name = feature.properties.name || "Невідомий район";
                layer.bindPopup(`<b>${name}</b><br>Кількість МУО: ${feature.properties.muoCount}`);
            }
        });
        
        choroplethLayer.addLayer(districtsLayer);
    })
    .catch(err => {
        console.error("Помилка завантаження районів:", err);
    });
}
