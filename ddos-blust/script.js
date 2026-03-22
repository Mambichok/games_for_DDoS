(() => {
  const BOARD_SIZE = 10;

  /**
   * Piece shapes as 2D matrices (1 = filled).
   * These are fixed; we rotate randomly when generating.
   */
  const BASE_PIECES = [
    // Single
    [[1]],
    // 2-line
    [[1, 1]],
    [[1], [1]],
    // 3-line
    [[1, 1, 1]],
    [[1], [1], [1]],
    // 4-line
    [[1, 1, 1, 1]],
    [[1], [1], [1], [1]],
    // 5-line
    [[1, 1, 1, 1, 1]],
    [[1], [1], [1], [1], [1]],
    // Square
    [
      [1, 1],
      [1, 1],
    ],
    [
      [1, 1, 1],
      [1, 1, 1],
      [1, 1, 1],
    ],
    // L-shapes
    [
      [1, 0],
      [1, 0],
      [1, 1],
    ],
    [
      [0, 1],
      [0, 1],
      [1, 1],
    ],
    [
      [1, 1, 1],
      [1, 0, 0],
    ],
    [
      [1, 1, 1],
      [0, 0, 1],
    ],
    // T-shapes
    [
      [1, 1, 1],
      [0, 1, 0],
    ],
    [
      [0, 1],
      [1, 1],
      [0, 1],
    ],
    // Zigzag
    [
      [1, 1, 0],
      [0, 1, 1],
    ],
    [
      [0, 1, 1],
      [1, 1, 0],
    ],
  ];

  const boardEl = document.getElementById("board");
  const piecesContainerEl = document.getElementById("pieces-container");
  const scoreEl = document.getElementById("score");
  const finalScoreEl = document.getElementById("final-score");
  const gameOverEl = document.getElementById("game-over");
  const resetBtn = document.getElementById("reset-btn");
  const playAgainBtn = document.getElementById("play-again-btn");

  let board = [];
  let pieces = [];
  let selectedPieceIndex = null;
  let score = 0;
  let isGameOver = false;

  function createEmptyBoard() {
    return Array.from({ length: BOARD_SIZE }, () =>
      Array.from({ length: BOARD_SIZE }, () => 0)
    );
  }

  function rotateMatrix(matrix) {
    const rows = matrix.length;
    const cols = matrix[0].length;
    const res = Array.from({ length: cols }, () => Array(rows).fill(0));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        res[c][rows - 1 - r] = matrix[r][c];
      }
    }
    return res;
  }

  function randomPiece() {
    const base = BASE_PIECES[Math.floor(Math.random() * BASE_PIECES.length)];
    let mat = base;
    const rotations = Math.floor(Math.random() * 4);
    for (let i = 0; i < rotations; i++) {
      mat = rotateMatrix(mat);
    }
    const colorAlt = Math.random() < 0.45;
    return { matrix: mat, used: false, colorAlt };
  }

  function generateNewPieces() {
    pieces = [randomPiece(), randomPiece(), randomPiece()];
    selectedPieceIndex = null;
    renderPieces();
  }

  function renderBoard() {
    boardEl.innerHTML = "";
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const cell = document.createElement("div");
        cell.className = "cell" + (board[r][c] ? " cell-filled" : "");
        cell.dataset.row = String(r);
        cell.dataset.col = String(c);
        cell.addEventListener("mouseenter", handleCellHover);
        cell.addEventListener("mouseleave", clearPreview);
        cell.addEventListener("click", handleCellClick);
        boardEl.appendChild(cell);
      }
    }
  }

  function renderPieces() {
    piecesContainerEl.innerHTML = "";
    pieces.forEach((piece, index) => {
      const wrap = document.createElement("div");
      wrap.className = "piece-wrapper" + (piece.used ? " used" : "");
      if (selectedPieceIndex === index && !piece.used) {
        wrap.classList.add("selected");
      }
      wrap.addEventListener("click", () => {
        if (piece.used || isGameOver) return;
        if (selectedPieceIndex === index) {
          selectedPieceIndex = null;
        } else {
          selectedPieceIndex = index;
        }
        renderPieces();
      });

      const rows = piece.matrix.length;
      const cols = piece.matrix[0].length;

      const grid = document.createElement("div");
      grid.className = "piece-grid";
      grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (!piece.matrix[r][c]) {
            const empty = document.createElement("div");
            empty.style.width = "16px";
            empty.style.height = "16px";
            grid.appendChild(empty);
          } else {
            const cell = document.createElement("div");
            cell.className = "piece-cell" + (piece.colorAlt ? " alt" : "");
            grid.appendChild(cell);
          }
        }
      }

      wrap.appendChild(grid);
      piecesContainerEl.appendChild(wrap);
    });
  }

  function updateScore(delta) {
    if (!delta) return;
    score += delta;
    scoreEl.textContent = String(score);
    scoreEl.classList.remove("pulse-score");
    // Force reflow for retrigger
    void scoreEl.offsetWidth;
    scoreEl.classList.add("pulse-score");
  }

  function canPlace(piece, startRow, startCol) {
    const m = piece.matrix;
    for (let r = 0; r < m.length; r++) {
      for (let c = 0; c < m[0].length; c++) {
        if (!m[r][c]) continue;
        const br = startRow + r;
        const bc = startCol + c;
        if (br < 0 || br >= BOARD_SIZE || bc < 0 || bc >= BOARD_SIZE) {
          return false;
        }
        if (board[br][bc]) return false;
      }
    }
    return true;
  }

  function placePiece(piece, startRow, startCol) {
    const m = piece.matrix;
    let placedCells = 0;
    for (let r = 0; r < m.length; r++) {
      for (let c = 0; c < m[0].length; c++) {
        if (!m[r][c]) continue;
        const br = startRow + r;
        const bc = startCol + c;
        board[br][bc] = 1;
        placedCells++;
      }
    }
    return placedCells;
  }

  function clearCompletedLines() {
    let cleared = 0;

    const fullRows = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
      if (board[r].every((v) => v === 1)) {
        fullRows.push(r);
      }
    }

    const fullCols = [];
    for (let c = 0; c < BOARD_SIZE; c++) {
      let full = true;
      for (let r = 0; r < BOARD_SIZE; r++) {
        if (!board[r][c]) {
          full = false;
          break;
        }
      }
      if (full) fullCols.push(c);
    }

    cleared = fullRows.length + fullCols.length;

    fullRows.forEach((r) => {
      for (let c = 0; c < BOARD_SIZE; c++) {
        board[r][c] = 0;
      }
    });
    fullCols.forEach((c) => {
      for (let r = 0; r < BOARD_SIZE; r++) {
        board[r][c] = 0;
      }
    });

    if (cleared > 0) {
      const base = cleared * 10;
      const bonus = cleared > 1 ? cleared * 5 : 0;
      updateScore(base + bonus);
    }
  }

  function hasAnyValidMoves() {
    const availablePieces = pieces.filter((p) => !p.used);
    if (!availablePieces.length) return true;

    for (const piece of availablePieces) {
      const rows = piece.matrix.length;
      const cols = piece.matrix[0].length;
      for (let r = 0; r <= BOARD_SIZE - rows; r++) {
        for (let c = 0; c <= BOARD_SIZE - cols; c++) {
          if (canPlace(piece, r, c)) return true;
        }
      }
    }
    return false;
  }

  function checkForNewPiecesOrGameOver() {
    if (pieces.every((p) => p.used)) {
      generateNewPieces();
      return;
    }

    if (!hasAnyValidMoves()) {
      isGameOver = true;
      gameOverEl.classList.remove("hidden");
      finalScoreEl.textContent = String(score);
    }
  }

  function clearPreview() {
    const cells = boardEl.querySelectorAll(".cell-preview, .cell-preview-invalid");
    cells.forEach((cell) => {
      cell.classList.remove("cell-preview", "cell-preview-invalid");
    });
  }

  function handleCellHover(e) {
    if (selectedPieceIndex === null || isGameOver) return;
    const piece = pieces[selectedPieceIndex];
    if (!piece || piece.used) return;

    clearPreview();

    const target = e.currentTarget;
    const row = parseInt(target.dataset.row, 10);
    const col = parseInt(target.dataset.col, 10);

    const valid = canPlace(piece, row, col);
    const className = valid ? "cell-preview" : "cell-preview-invalid";

    const m = piece.matrix;
    for (let r = 0; r < m.length; r++) {
      for (let c = 0; c < m[0].length; c++) {
        if (!m[r][c]) continue;
        const br = row + r;
        const bc = col + c;
        if (br < 0 || br >= BOARD_SIZE || bc < 0 || bc >= BOARD_SIZE) {
          continue;
        }
        const idx = br * BOARD_SIZE + bc;
        const cell = boardEl.children[idx];
        cell.classList.add(className);
      }
    }
  }

  function handleCellClick(e) {
    if (selectedPieceIndex === null || isGameOver) return;
    const piece = pieces[selectedPieceIndex];
    if (!piece || piece.used) return;

    const target = e.currentTarget;
    const row = parseInt(target.dataset.row, 10);
    const col = parseInt(target.dataset.col, 10);

    if (!canPlace(piece, row, col)) {
      clearPreview();
      return;
    }

    const placedCells = placePiece(piece, row, col);
    piece.used = true;
    selectedPieceIndex = null;

    updateScore(placedCells);
    clearCompletedLines();
    renderBoard();
    renderPieces();
    checkForNewPiecesOrGameOver();
  }

  function resetGame() {
    board = createEmptyBoard();
    pieces = [];
    selectedPieceIndex = null;
    score = 0;
    isGameOver = false;
    scoreEl.textContent = "0";
    gameOverEl.classList.add("hidden");
    renderBoard();
    generateNewPieces();
  }

  resetBtn?.addEventListener("click", resetGame);
  playAgainBtn?.addEventListener("click", resetGame);

  resetGame();
})();

