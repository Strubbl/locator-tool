import ltMap from '../ltMap';
import template from './ltAllMap.html';

const DEFAULT_MAP_VIEW = {
  lat: 51.505,
  lng: -0.09,
  zoom: 13
};

class controller {
  constructor(ltData, $stateParams, localStorageService) {
    this.mapView = localStorageService.get('mapView') || DEFAULT_MAP_VIEW;
    ltData.getFiles($stateParams).then(ltData.getCoordinates).then(titles => {
      this.titles = titles;
    });
  }

  mapInit(L, map) {
    new ltMap.controller._mapInit(L, map);
  }
}
controller.$inject = [
  'ltData',
  '$stateParams',
  'localStorageService'
];

export default {
  template,
  controller
};
