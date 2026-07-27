class GoUI {
    constructor() {
        this.boardSize = 9;
        this.canvas = document.getElementById('go-board');
        this.ctx = this.canvas.getContext('2d');
        this.chartCanvas = document.getElementById('chart-canvas');
        this.chartCtx = this.chartCanvas.getContext('2d');
        
        this.board = new GoBoard(this.boardSize);
        this.trainer = new EveTrainer(this.boardSize);
        this.mode = 'training';
        this.playerColor = 1;
        this.gameBoard = new GoBoard(this.boardSize);
        
        this.cellSize = 50;
        this.offset = 30;
        
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.drawBoard();
        this.loadLatestModel();
        this.drawChart();
    }

    setupEventListeners() {
        this.canvas.addEventListener('click', (e) => this.handleBoardClick(e));
        
        document.getElementById('btn-training').addEventListener('click', () => this.switchMode('training'));
        document.getElementById('btn-play').addEventListener('click', () => this.switchMode('play'));
        
        document.getElementById('btn-start-training').addEventListener('click', () => this.startTraining());
        document.getElementById('btn-stop-training').addEventListener('click', () => this.stopTraining());
        document.getElementById('btn-load-model').addEventListener('click', () => this.loadModel());
        document.getElementById('btn-save-model').addEventListener('click', () => this.saveModel());
        
        document.getElementById('btn-reset-game').addEventListener('click', () => this.resetGame());
        document.getElementById('btn-pass').addEventListener('click', () => this.pass());
        document.getElementById('btn-ai-move').addEventListener('click', () => this.aiMove());
        
        document.getElementById('model-upload').addEventListener('change', (e) => this.handleFileUpload(e));
        document.getElementById('btn-upload-model').addEventListener('click', () => this.uploadModel());
    }

    switchMode(mode) {
        this.mode = mode;
        
        document.getElementById('btn-training').classList.toggle('active', mode === 'training');
        document.getElementById('btn-play').classList.toggle('active', mode === 'play');
        
        document.getElementById('training-controls').classList.toggle('hidden', mode !== 'training');
        document.getElementById('play-controls').classList.toggle('hidden', mode !== 'play');
        
        if (mode === 'play') {
            this.resetGame();
        } else {
            this.board.initBoard();
            this.drawBoard();
        }
    }

    handleBoardClick(e) {
        if (this.mode !== 'play') return;
        
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        const col = Math.round((x - this.offset) / this.cellSize);
        const row = Math.round((y - this.offset) / this.cellSize);
        
        if (row >= 0 && row < this.boardSize && col >= 0 && col < this.boardSize) {
            if (this.gameBoard.currentPlayer === this.playerColor) {
                if (this.gameBoard.makeMove(row, col)) {
                    this.drawBoard(this.gameBoard);
                    this.updateGameInfo();
                    
                    if (!this.gameBoard.isGameOver()) {
                        setTimeout(() => this.aiMove(), 500);
                    } else {
                        this.showGameResult();
                    }
                }
            }
        }
    }

    drawBoard(board = this.board) {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        ctx.strokeStyle = '#5c4033';
        ctx.lineWidth = 2;
        
        for (let i = 0; i < this.boardSize; i++) {
            const pos = this.offset + i * this.cellSize;
            ctx.beginPath();
            ctx.moveTo(this.offset, pos);
            ctx.lineTo(this.offset + (this.boardSize - 1) * this.cellSize, pos);
            ctx.stroke();
            
            ctx.beginPath();
            ctx.moveTo(pos, this.offset);
            ctx.lineTo(pos, this.offset + (this.boardSize - 1) * this.cellSize);
            ctx.stroke();
        }
        
        const starPoints = [[2, 2], [2, 6], [4, 4], [6, 2], [6, 6]];
        for (const [r, c] of starPoints) {
            const x = this.offset + c * this.cellSize;
            const y = this.offset + r * this.cellSize;
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fillStyle = '#5c4033';
            ctx.fill();
        }
        
        for (let i = 0; i < this.boardSize; i++) {
            for (let j = 0; j < this.boardSize; j++) {
                const stone = board.board[i][j];
                if (stone !== 0) {
                    const x = this.offset + j * this.cellSize;
                    const y = this.offset + i * this.cellSize;
                    
                    ctx.beginPath();
                    ctx.arc(x, y, this.cellSize / 2 - 2, 0, Math.PI * 2);
                    
                    const gradient = ctx.createRadialGradient(
                        x - 5, y - 5, 2,
                        x, y, this.cellSize / 2 - 2
                    );
                    
                    if (stone === 1) {
                        gradient.addColorStop(0, '#555');
                        gradient.addColorStop(1, '#111');
                    } else {
                        gradient.addColorStop(0, '#fff');
                        gradient.addColorStop(1, '#ddd');
                    }
                    
                    ctx.fillStyle = gradient;
                    ctx.fill();
                    
                    ctx.strokeStyle = stone === 1 ? '#000' : '#ccc';
                    ctx.lineWidth = 1;
                    ctx.stroke();
                }
            }
        }
    }

    async startTraining() {
        this.log('开始训练...', 'info');
        
        this.trainer.onUpdate = (data) => {
            if (data.board) {
                this.drawBoard(new GoBoard(this.boardSize));
                const tempBoard = new GoBoard(this.boardSize);
                tempBoard.setState(data.board);
                this.drawBoard(tempBoard);
            } else {
                document.getElementById('generation').textContent = data.generation;
                document.getElementById('progress').textContent = `${Math.round(data.progress)}%`;
                document.getElementById('games-played').textContent = data.totalGames;
                
                const recentStats = this.trainer.getTrainingStats();
                document.getElementById('win-rate').textContent = `${Math.round(recentStats.recentWinRate * 100)}%`;
                
                this.drawChart();
            }
        };
        
        this.trainer.onGameEnd = (data) => {
            const winner = data.winRate > 0.5 ? '黑方' : '白方';
            this.log(`第${data.generation}代训练完成，胜率: ${Math.round(data.winRate * 100)}%`, 'success');
            this.drawChart();
        };
        
        document.getElementById('training-status').textContent = '是';
        await this.trainer.startTraining(5, 100);
    }

    stopTraining() {
        this.trainer.stopTraining();
        document.getElementById('training-status').textContent = '否';
        this.log('训练已停止', 'warning');
    }

    resetGame() {
        this.gameBoard.initBoard();
        this.playerColor = 1;
        this.drawBoard(this.gameBoard);
        this.updateGameInfo();
    }

    pass() {
        if (this.mode === 'play') {
            this.gameBoard.pass();
            this.drawBoard(this.gameBoard);
            this.updateGameInfo();
            
            if (!this.gameBoard.isGameOver()) {
                setTimeout(() => this.aiMove(), 500);
            } else {
                this.showGameResult();
            }
        }
    }

    aiMove() {
        if (this.mode !== 'play' || this.gameBoard.isGameOver()) return;
        
        const difficulty = document.getElementById('difficulty-select').value;
        const move = this.trainer.getAIResponse(this.gameBoard, difficulty);
        
        if (move) {
            this.gameBoard.makeMove(move[0], move[1]);
        } else {
            this.gameBoard.pass();
        }
        
        this.drawBoard(this.gameBoard);
        this.updateGameInfo();
        
        if (this.gameBoard.isGameOver()) {
            this.showGameResult();
        }
    }

    updateGameInfo() {
        const player = this.gameBoard.currentPlayer === 1 ? '黑方' : '白方';
        document.getElementById('current-player').textContent = player;
        
        const score = this.gameBoard.calculateScore();
        document.getElementById('black-score').textContent = score.black.toFixed(1);
        document.getElementById('white-score').textContent = score.white.toFixed(1);
    }

    showGameResult() {
        const winner = this.gameBoard.getWinner();
        let message = '';
        
        if (winner === 0) {
            message = '平局！';
        } else {
            message = winner === 1 ? '黑方获胜！' : '白方获胜！';
        }
        
        this.log(message, 'success');
        alert(message);
    }

    drawChart() {
        const ctx = this.chartCtx;
        ctx.clearRect(0, 0, this.chartCanvas.width, this.chartCanvas.height);
        
        const history = this.trainer.getTrainingStats().winHistory;
        if (history.length === 0) return;
        
        const padding = 40;
        const width = this.chartCanvas.width - padding * 2;
        const height = this.chartCanvas.height - padding * 2;
        
        ctx.strokeStyle = '#00d2ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        
        const stepX = width / (history.length - 1 || 1);
        
        for (let i = 0; i < history.length; i++) {
            const x = padding + i * stepX;
            const y = padding + height * (1 - history[i].winRate);
            
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        
        ctx.stroke();
        
        ctx.fillStyle = '#00d2ff';
        for (let i = 0; i < history.length; i++) {
            const x = padding + i * stepX;
            const y = padding + height * (1 - history[i].winRate);
            
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fill();
        }
        
        ctx.fillStyle = '#aaa';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        
        for (let i = 0; i < history.length; i += Math.max(1, Math.floor(history.length / 10))) {
            const x = padding + i * stepX;
            ctx.fillText(`Gen ${history[i].generation}`, x, this.chartCanvas.height - 10);
        }
        
        ctx.textAlign = 'right';
        ctx.fillText('100%', padding - 10, padding);
        ctx.fillText('50%', padding - 10, padding + height / 2);
        ctx.fillText('0%', padding - 10, padding + height);
    }

    log(message, type = 'info') {
        const logContent = document.getElementById('log-content');
        const p = document.createElement('p');
        p.className = type;
        p.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
        logContent.appendChild(p);
        logContent.scrollTop = logContent.scrollHeight;
    }

    async loadLatestModel() {
        const loaded = await this.trainer.loadLatestModel();
        if (loaded) {
            const stats = this.trainer.getTrainingStats();
            document.getElementById('generation').textContent = stats.generation;
            document.getElementById('games-played').textContent = stats.gamesPlayed;
            document.getElementById('win-rate').textContent = `${Math.round(stats.recentWinRate * 100)}%`;
            this.drawChart();
            this.log('已加载最新模型', 'success');
        }
    }

    loadModel() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    try {
                        const data = JSON.parse(event.target.result);
                        this.trainer.loadTrainingData(data);
                        const stats = this.trainer.getTrainingStats();
                        document.getElementById('generation').textContent = stats.generation;
                        document.getElementById('games-played').textContent = stats.gamesPlayed;
                        document.getElementById('win-rate').textContent = `${Math.round(stats.recentWinRate * 100)}%`;
                        this.drawChart();
                        this.log('模型加载成功', 'success');
                    } catch (err) {
                        this.log('模型加载失败', 'error');
                    }
                };
                reader.readAsText(file);
            }
        };
        input.click();
    }

    saveModel() {
        this.trainer.saveTrainingData();
        this.log('模型已保存', 'success');
    }

    handleFileUpload(e) {
        this.uploadFile = e.target.files[0];
    }

    uploadModel() {
        if (!this.uploadFile) {
            document.getElementById('upload-status').textContent = '请先选择文件';
            return;
        }
        
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target.result);
                this.trainer.loadTrainingData(data);
                const stats = this.trainer.getTrainingStats();
                document.getElementById('generation').textContent = stats.generation;
                document.getElementById('games-played').textContent = stats.gamesPlayed;
                document.getElementById('win-rate').textContent = `${Math.round(stats.recentWinRate * 100)}%`;
                this.drawChart();
                document.getElementById('upload-status').textContent = '模型上传成功！';
                this.log('模型上传成功', 'success');
            } catch (err) {
                document.getElementById('upload-status').textContent = '模型上传失败';
                this.log('模型上传失败', 'error');
            }
        };
        reader.readAsText(this.uploadFile);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new GoUI();
});