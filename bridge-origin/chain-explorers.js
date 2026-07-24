(function() {
    'use strict';

    const DEFAULT_EXPLORER_URL = 'https://etherscan.io/address/';

    // Add new bridge-supported chains here; the lookup maps below are generated from this list.
    const chainDefinitions = [
        { chainId: '1', name: 'Ethereum', explorer: 'https://etherscan.io/address/', aliases: ['eth', 'ethereum'] },
        { chainId: '10', name: 'Optimism', explorer: 'https://optimistic.etherscan.io/address/', aliases: ['optimism'] },
        { chainId: '25', name: 'Cronos', explorer: 'https://explorer.cronos.org/address/', aliases: ['cronos'], debridgeIds: [100000019] },
        { chainId: '56', name: 'BNB Chain', explorer: 'https://bscscan.com/address/', aliases: ['bnb', 'bsc'] },
        { chainId: '100', name: 'Gnosis', explorer: 'https://gnosisscan.io/address/', aliases: ['gnosis'], debridgeIds: [100000002] },
        { chainId: '130', name: 'Unichain', explorer: 'https://uniscan.xyz/address/', aliases: ['unichain'] },
        { chainId: '137', name: 'Polygon', explorer: 'https://polygonscan.com/address/', aliases: ['polygon', 'pol'] },
        { chainId: '143', name: 'Monad', explorer: 'https://monadscan.com/address/', aliases: ['monad'], debridgeIds: [100000030] },
        { chainId: '146', name: 'Sonic', explorer: 'https://sonicscan.org/address/', aliases: ['sonic'], debridgeIds: [100000014] },
        { chainId: '169', name: 'Manta', explorer: 'https://pacific-explorer.manta.network/address/', aliases: ['manta'] },
        { chainId: '196', name: 'X Layer', explorer: 'https://www.okx.com/web3/explorer/xlayer/address/', aliases: ['xlayer'] },
        { chainId: '250', name: 'Fantom', explorer: 'https://ftmscan.com/address/', aliases: ['fantom'] },
        { chainId: '252', name: 'Fraxtal', explorer: 'https://fraxscan.com/address/', aliases: ['frax', 'fraxtal'] },
        { chainId: '324', name: 'zkSync Era', explorer: 'https://era.zksync.network/address/', aliases: ['zksync'] },
        { chainId: '360', name: 'Shape', explorer: 'https://shapescan.xyz/address/', aliases: ['shape'] },
        { chainId: '388', name: 'Cronos zkEVM', explorer: 'https://explorer.zkevm.cronos.org/address/', aliases: ['cronos-zkevm'], debridgeIds: [100000010] },
        { chainId: '480', name: 'World Chain', explorer: 'https://worldscan.org/address/', aliases: ['worldchain', 'wc'] },
        { chainId: '690', name: 'Redstone', explorer: 'https://explorer.redstone.xyz/address/', aliases: ['redstone'] },
        { chainId: '747', name: 'Flow', explorer: 'https://evm.flowscan.io/address/', aliases: ['flow'], debridgeIds: [100000009] },
        { chainId: '988', name: 'Stable Chain', explorer: 'https://stablescan.xyz/address/', aliases: ['stable'] },
        { chainId: '999', name: 'HyperEVM', explorer: 'https://hyperevmscan.io/address/', aliases: ['hyperevm', 'hyperliquid'], debridgeIds: [100000022] },
        { chainId: '1088', name: 'Metis', explorer: 'https://andromeda-explorer.metis.io/address/', aliases: ['metis'], debridgeIds: [100000004] },
        { chainId: '1329', name: 'Sei', explorer: 'https://seitrace.com/address/', aliases: ['sei'], debridgeIds: [100000027] },
        { chainId: '1514', name: 'Story', explorer: 'https://www.storyscan.xyz/address/', aliases: ['story'], debridgeIds: [100000013] },
        { chainId: '1776', name: 'Injective', explorer: 'https://inevm.calderaexplorer.xyz/address/', aliases: ['injective'], debridgeIds: [100000029] },
        { chainId: '1890', name: 'LightLink', explorer: 'https://phoenix.lightlink.io/address/', aliases: ['lightlink'], debridgeIds: [100000003] },
        { chainId: '1923', name: 'Swell', explorer: 'https://swellchainscan.io/address/', aliases: ['swell'] },
        { chainId: '2741', name: 'Abstract', explorer: 'https://abscan.org/address/', aliases: ['abstract'], debridgeIds: [100000017] },
        { chainId: '4158', name: 'CrossFi', explorer: 'https://xfiscan.com/address/', aliases: ['crossfi'], debridgeIds: [100000006] },
        { chainId: '4217', name: 'Tempo', explorer: 'https://explorer.tempo.xyz/address/', aliases: ['tempo'] },
        { chainId: '4326', name: 'MegaETH', explorer: 'https://mega.etherscan.io/address/', aliases: ['megaeth'], debridgeIds: [100000031] },
        { chainId: '4663', name: 'Robinhood', explorer: 'https://robinhoodchain.blockscout.com/address/', aliases: ['robinhood', 'robinhood-chain', 'robinhood-chain-mainnet', 'robinhoodchain'] },
        { chainId: '5000', name: 'Mantle', explorer: 'https://mantlescan.xyz/address/', aliases: ['mantle'], debridgeIds: [100000023] },
        { chainId: '6342', name: 'MegaETH Testnet', explorer: 'https://megaexplorer.xyz/address/', aliases: ['megaeth-testnet'] },
        { chainId: '7171', name: 'Bitrock', explorer: 'https://explorer.bit-rock.io/address/', aliases: ['bitrock'], debridgeIds: [100000005] },
        { chainId: '8453', name: 'Base', explorer: 'https://basescan.org/address/', aliases: ['base'] },
        { chainId: '9745', name: 'Plasma', explorer: 'https://plasmascan.to/address/', aliases: ['plasma'], debridgeIds: [100000028] },
        { chainId: '32769', name: 'Zilliqa', explorer: 'https://evmx.zilliqa.com/address/', aliases: ['zilliqa'], debridgeIds: [100000008] },
        { chainId: '33139', name: 'ApeChain', explorer: 'https://apescan.io/address/', aliases: ['apechain'] },
        { chainId: '42161', name: 'Arbitrum One', explorer: 'https://arbiscan.io/address/', aliases: ['arb1', 'arbitrum'] },
        { chainId: '43114', name: 'Avalanche', explorer: 'https://snowscan.xyz/address/', aliases: ['avalanche', 'avax'] },
        { chainId: '48900', name: 'Zircuit', explorer: 'https://explorer.zircuit.com/address/', aliases: ['zircuit'], debridgeIds: [100000015] },
        { chainId: '50104', name: 'Sophon', explorer: 'https://explorer.sophon.xyz/address/', aliases: ['sophon'], debridgeIds: [100000025] },
        { chainId: '57073', name: 'Ink', explorer: 'https://explorer.inkonchain.com/address/', aliases: ['ink'] },
        { chainId: '59144', name: 'Linea', explorer: 'https://lineascan.build/address/', aliases: ['linea'] },
        { chainId: '60808', name: 'BOB', explorer: 'https://explorer.gobob.xyz/address/', aliases: ['bob'], debridgeIds: [100000021] },
        { chainId: '80094', name: 'Berachain', explorer: 'https://berascan.com/address/', aliases: ['berachain'], debridgeIds: [100000020] },
        { chainId: '81457', name: 'Blast', explorer: 'https://blastscan.io/address/', aliases: ['blast'] },
        { chainId: '84532', name: 'Base Sepolia', explorer: 'https://sepolia.basescan.org/address/', aliases: ['base-sepolia'] },
        { chainId: '98866', name: 'Plume', explorer: 'https://explorer.plume.org/address/', aliases: ['plume'], debridgeIds: [100000024] },
        { chainId: '534352', name: 'Scroll', explorer: 'https://scrollscan.com/address/', aliases: ['scroll', 'scr'] },
        { chainId: '747474', name: 'Katana', explorer: 'https://katanascan.com/address/', aliases: ['ronin', 'katana'] },
        { chainId: '501474', name: 'Solana', explorer: 'https://solscan.io/account/', aliases: ['solana-mainnet'] },
        { chainId: '7565164', name: 'Solana', explorer: 'https://solscan.io/account/', aliases: ['solana', 'sol'] },
        { chainId: '7777777', name: 'Zora', explorer: 'https://zora.superscan.network/address/', aliases: ['zora'] },
        { chainId: '245022934', name: 'Neon', explorer: 'https://neonscan.org/address/', aliases: ['neon'], debridgeIds: [100000001] },
        { chainId: '666666666', name: 'Degen', explorer: 'https://explorer.degen.tips/address/', aliases: ['degen'] },
        { chainId: '728126428', name: 'Tron', explorer: 'https://tronscan.org/#/address/', aliases: ['tron'], debridgeIds: [100000026] },
        { chainId: '792703809', name: 'Solana', explorer: 'https://solscan.io/account/', aliases: ['solana-alt'] },
        { chainId: '1151111081099710', name: 'Solana', explorer: 'https://solscan.io/account/', aliases: ['solana-alt-2'] },
        { chainId: '9270000000000000', name: 'Sui', explorer: 'https://suiscan.xyz/mainnet/account/', aliases: ['sui'] },
        { chainId: 'bitcoin', name: 'Bitcoin', explorer: 'https://mempool.space/address/', aliases: ['btc', 'bitcoin'] },
    ];

    function addAlias(chainNameToId, alias, chainId) {
        const value = String(alias || '').trim().toLowerCase();
        if (!value) return;

        const slug = value
            .replace(/[_\s]+/g, '-')
            .replace(/[^a-z0-9-]/g, '');
        const compact = slug.replace(/-/g, '');

        [value, slug, compact].forEach(candidate => {
            if (candidate) chainNameToId[candidate] = chainId;
        });
    }

    function buildChainRegistry(definitions) {
        const debridgeChains = {};
        const chainExplorers = { default: DEFAULT_EXPLORER_URL };
        const chainNameToId = {};

        definitions.forEach(definition => {
            const chainId = String(definition.chainId);
            if (definition.explorer) {
                chainExplorers[chainId] = definition.explorer;
            }

            [definition.name, ...(definition.aliases || [])].forEach(alias => {
                addAlias(chainNameToId, alias, chainId);
            });

            (definition.debridgeIds || []).forEach(debridgeId => {
                debridgeChains[debridgeId] = {
                    chainId,
                    name: definition.name || chainId,
                };
            });
        });

        return { debridgeChains, chainExplorers, chainNameToId };
    }

    const {
        debridgeChains,
        chainExplorers,
        chainNameToId,
    } = buildChainRegistry(chainDefinitions);

    function getChainIdFromName(chainName) {
        const value = String(chainName || '').trim().toLowerCase();
        if (!value) return null;

        const slug = value
            .replace(/[_\s]+/g, '-')
            .replace(/[^a-z0-9-]/g, '');
        const compact = slug.replace(/-/g, '');

        return chainNameToId[value] || chainNameToId[slug] || chainNameToId[compact] || null;
    }

    function getChainIdFromDebridge(chainId) {
        const namedChainId = getChainIdFromName(chainId);
        if (namedChainId) return namedChainId;

        const id = typeof chainId === 'string' ? parseInt(chainId, 10) : chainId;
        return debridgeChains[id]?.chainId || String(chainId);
    }

    function isDebridgeId(chainId) {
        const id = typeof chainId === 'string' ? parseInt(chainId, 10) : chainId;
        return id >= 100000000 && id < 200000000;
    }

    function getExplorerUrl(chainId, address) {
        const resolvedId = getChainIdFromDebridge(chainId);
        const baseUrl = chainExplorers[resolvedId] || chainExplorers.default;
        return `${baseUrl}${address}`;
    }

    window.EvmoleBridgeOriginExplorers = {
        chainDefinitions,
        debridgeChains,
        chainExplorers,
        chainNameToId,
        isDebridgeId,
        getChainIdFromDebridge,
        getChainIdFromName,
        getExplorerUrl,
    };
})();
