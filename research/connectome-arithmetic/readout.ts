export const cutoffs = [1e-4, 1e-6, 1e-8, 1e-10, 1e-12];

export function fitReadout(design: number[][], labels: number[]) {
  const width = design[0].length;
  const columns = Array.from({ length: width }, (_, i) =>
    Float64Array.from(design, (row) => row[i]),
  );
  const vectors = columns.map((_, i) =>
    Float64Array.from({ length: width }, (_, j) => Number(i === j)),
  );

  // Rotate the design columns directly so small singular values survive the fit.
  for (let sweep = 0; sweep < 100; sweep++) {
    let changed = false;
    for (let i = 0; i < width; i++) {
      const left = columns[i];
      for (let j = i + 1; j < width; j++) {
        const right = columns[j];
        let a = 0;
        let b = 0;
        let cross = 0;
        for (let k = 0; k < left.length; k++) {
          a += left[k] ** 2;
          b += right[k] ** 2;
          cross += left[k] * right[k];
        }
        if (Math.abs(cross) <= 1e-14 * Math.sqrt(a * b)) {
          continue;
        }
        changed = true;
        const ratio = (b - a) / (2 * cross);
        const tangent =
          (ratio < 0 ? -1 : 1) / (Math.abs(ratio) + Math.hypot(1, ratio));
        const cosine = 1 / Math.hypot(1, tangent);
        const sine = cosine * tangent;
        for (const [x, y] of [
          [left, right],
          [vectors[i], vectors[j]],
        ]) {
          for (let k = 0; k < x.length; k++) {
            const previous = x[k];
            x[k] = cosine * previous - sine * y[k];
            y[k] = sine * previous + cosine * y[k];
          }
        }
      }
    }
    if (!changed) {
      break;
    }
    if (sweep === 99) {
      throw Error("Readout SVD failed to converge");
    }
  }

  const norms = columns.map((column) =>
    column.reduce((sum, value) => sum + value ** 2, 0),
  );
  const largest = Math.max(...norms);
  return cutoffs.map((cutoff) => {
    const coefficients = Array<number>(width).fill(0);
    for (let i = 0; i < width; i++) {
      if (norms[i] > largest * cutoff ** 2) {
        const projection =
          columns[i].reduce((sum, value, row) => sum + value * labels[row], 0) /
          norms[i];
        for (let j = 0; j < width; j++) {
          coefficients[j] += projection * vectors[i][j];
        }
      }
    }
    return coefficients;
  });
}
