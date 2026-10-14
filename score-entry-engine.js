(function(global) {
  'use strict';

  function canAdvance(value, max) {
    var text = String(value);
    return text === '0' || text.length >= String(max).length || Number(text) * 10 > max;
  }

  function nextPos(row, column, rowCount, lastColumn, direction) {
    if (direction === 'col') {
      return row < rowCount - 1 ? [row + 1, column] : column < lastColumn ? [0, column + 1] : null;
    }
    return column < lastColumn ? [row, column + 1] : row < rowCount - 1 ? [row + 1, 0] : null;
  }

  function prevPos(row, column, rowCount, lastColumn, direction) {
    if (direction === 'col') {
      return row > 0 ? [row - 1, column] : column > 0 ? [rowCount - 1, column - 1] : null;
    }
    return column > 0 ? [row, column - 1] : row > 0 ? [row - 1, lastColumn] : null;
  }

  function normalize(value) {
    var text = String(value).replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    return text;
  }

  function create(options) {
    return {
      canAdvance: canAdvance,
      next: function(row, column) {
        return nextPos(row, column, options.rowCount, options.lastColumn, options.direction());
      },
      previous: function(row, column) {
        return prevPos(row, column, options.rowCount, options.lastColumn, options.direction());
      },
      append: function(current, digit, max) {
        var candidate = normalize(String(current || '') + String(digit));
        if (candidate !== '' && Number(candidate) > max) {
          return { accepted: false, value: normalize(current || '') };
        }
        return { accepted: true, value: candidate };
      },
      normalize: normalize
    };
  }

  global.ScoreEntryEngine = { create: create, canAdvance: canAdvance, nextPos: nextPos, prevPos: prevPos, normalize: normalize };
})(window);
