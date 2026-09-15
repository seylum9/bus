// 対象18路線はすべて、保存済みHTMLから検証・抽出したデータを使う。
const TIMETABLE_GROUPS = [ROUTE_20_120, ROUTE_23, ROUTE_24_27_80_92_110, ROUTE_26, ROUTE_28_29, ROUTE_63, ROUTE_32_43_132_143_385, ROUTE_52];
function getTimetableStops(direction) {
  const stops = [...DIRECTIONAL_GTFS[direction].stops];
  // 美栄橋経由の分岐を、便詳細でも実際の停車順になる位置に追加する。
  const branch = ['久茂地公民館前', '美栄橋駅前', '牧志公園前'];
  const position = direction === 'outbound' ? stops.indexOf('県庁北口') + 1 : stops.indexOf('牧志');
  stops.splice(position, 0, ...(direction === 'outbound' ? branch : branch.reverse()));
  return stops;
}
function getTimetableRows(direction, stop, day) {
  return TIMETABLE_GROUPS.flatMap(group => {
    const routeDay = day === 'holiday' ? group.serviceDays.holiday : day;
    return group.directions[direction][routeDay]?.[stop] || [];
  });
}
