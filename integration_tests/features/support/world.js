const { setWorldConstructor, After, BeforeAll } = require("cucumber");

const BaseNodeProcess = require("../../helpers/baseNodeProcess");
const MergeMiningProxyProcess = require("../../helpers/mergeMiningProxyProcess");
const WalletProcess = require("../../helpers/walletProcess");
const MiningNodeProcess = require("../../helpers/miningNodeProcess");

class CustomWorld {
  constructor({ parameters }) {
    // this.variable = 0;
    this.seeds = {};
    this.nodes = {};
    this.proxies = {};
    this.miners = {};
    this.wallets = {};
    this.clients = {};
    this.headers = {};
    this.outputs = {};
    this.testrun = `run${Date.now()}`;
    this.lastResult = null;
    this.blocks = {};
    this.transactions = {};
    this.peers = {};
    this.transactionsMap = new Map();
    this.resultStack = [];
    this.tipHeight = 0;
    this.logFilePathBaseNode =
      parameters.logFilePathBaseNode || "./log4rs/base_node.yml";
    this.logFilePathProxy = parameters.logFilePathProxy || "./log4rs/proxy.yml";
    this.logFilePathWallet =
      parameters.logFilePathWallet || "./log4rs/wallet.yml";
  }

  async createSeedNode(name) {
    const proc = new BaseNodeProcess(
      `seed-${name}`,
      null,
      this.logFilePathBaseNode
    );
    await proc.startNew();
    this.seeds[name] = proc;
    this.clients[name] = proc.createGrpcClient();
  }

  seedAddresses() {
    const res = [];
    for (const property in this.seeds) {
      res.push(this.seeds[property].peerAddress());
    }
    return res;
  }

  /// Create but don't add the node
  createNode(name, options) {
    return new BaseNodeProcess(name, options, this.logFilePathBaseNode);
  }

  async createAndAddNode(name, addresses) {
    const node = this.createNode(name);
    if (Array.isArray(addresses)) {
      node.setPeerSeeds(addresses);
    } else {
      node.setPeerSeeds([addresses]);
    }
    await node.startNew();
    this.addNode(name, node);
  }

  addNode(name, process) {
    this.nodes[name] = process;
    this.clients[name] = process.createGrpcClient();
  }

  addMiningNode(name, process) {
    this.miners[name] = process;
  }

  addProxy(name, process) {
    this.proxies[name] = process;
  }

  async createAndAddWallet(name, nodeAddresses) {
    const wallet = new WalletProcess(name, {}, this.logFilePathWallet);
    wallet.setPeerSeeds([nodeAddresses]);
    await wallet.startNew();
    this.addWallet(name, wallet);
  }

  addWallet(name, process) {
    this.wallets[name] = process;
  }

  addOutput(name, output) {
    this.outputs[name] = output;
  }

  async mineBlock(name, weight, beforeSubmit, onError) {
    await this.clients[name].mineBlockWithoutWallet(
      beforeSubmit,
      weight,
      onError
    );
  }

  async mergeMineBlock(name, weight) {
    const client = this.proxies[name].createClient();
    await client.mineBlock(weight);
  }

  saveBlock(name, block) {
    this.blocks[name] = block;
  }

  async submitBlock(blockName, nodeName) {
    await this.clients[nodeName]
      .submitBlock(this.blocks[blockName].block)
      .catch((err) => {
        console.log("submit block erro", err);
      });
    // console.log(result);
  }

  getClient(name) {
    return this.clients[name];
  }

  getNode(name) {
    return this.nodes[name] || this.seeds[name];
  }

  getMiningNode(name) {
    return this.miners[name];
  }

  getWallet(name) {
    return this.wallets[name];
  }

  async getOrCreateWallet(name) {
    const wallet = this.getWallet(name);
    if (wallet) {
      return wallet;
    }
    await this.createAndAddWallet(name, this.seedAddresses());
    return this.getWallet(name);
  }

  getProxy(name) {
    return this.proxies[name];
  }

  async forEachClientAsync(f) {
    const promises = [];

    for (const property in this.seeds) {
      promises.push(f(this.getClient(property), property));
    }
    for (const property in this.nodes) {
      promises.push(f(this.getClient(property), property));
    }
    await Promise.all(promises);
  }

  async stopNode(name) {
    const node = this.seeds[name] || this.nodes[name];
    await node.stop();
  }

  async startNode(name) {
    const node = this.seeds[name] || this.nodes[name];
    await node.start();
  }

  addTransaction(pubKey, txId) {
    if (!this.transactionsMap.has(pubKey)) {
      this.transactionsMap.set(pubKey, []);
    }
    this.transactionsMap.get(pubKey).push(txId);
  }
}

setWorldConstructor(CustomWorld);

BeforeAll({ timeout: 1200000 }, async function () {
  const baseNode = new BaseNodeProcess("compile");
  console.log("Compiling base node...");
  await baseNode.init();
  await baseNode.compile();

  const wallet = new WalletProcess("compile");
  console.log("Compiling wallet...");
  await wallet.init();
  await wallet.compile();

  const mmProxy = new MergeMiningProxyProcess(
    "compile",
    "127.0.0.1:9999",
    "127.0.0.1:9998"
  );
  console.log("Compiling mmproxy...");
  await mmProxy.init();
  await mmProxy.compile();

  const miningNode = new MiningNodeProcess(
    "compile",
    "127.0.0.1:9999",
    "127.0.0.1:9998"
  );
  console.log("Compiling mining node...");
  await miningNode.init(1, 1, 1, true);
  await miningNode.compile();

  console.log("Finished compilation.");
});

After(async function () {
  console.log("Stopping nodes");
  for (const key in this.seeds) {
    await this.stopNode(key);
  }
  for (const key in this.nodes) {
    await this.stopNode(key);
  }
  for (const key in this.proxies) {
    await this.proxies[key].stop();
  }
  for (const key in this.wallets) {
    await this.wallets[key].stop();
  }
  for (const key in this.miners) {
    await this.miners[key].stop();
  }
});
