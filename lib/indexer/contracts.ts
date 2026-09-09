import { parseAbi } from "viem";
// Pons source: ponsdotdev/ponsfamily @ 8b9bf371030279133017b5c1b713823f5889c5d2.
export const ponsCurveAbi = parseAbi([
  "function token() view returns (address)", "function pairToken() view returns (address)", "function factory() view returns (address)",
  "function graduated() view returns (bool)", "function readyToGraduate() view returns (bool)",
  "function getReserves() view returns (uint256 quoteReserve, uint256 tokenReserve)", "function realQuoteReserve() view returns (uint256)",
  "function feeBps() view returns (uint256)", "function creatorTaxBps() view returns (uint256)", "function sellableTokens() view returns (uint256)",
  "function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) payable returns (uint256 tokensOut)",
  "function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient) returns (uint256 quoteOut)",
  "event CurveBuy(address indexed buyer, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 tax)",
  "event CurveSell(address indexed seller, address indexed recipient, uint256 tokensIn, uint256 quoteOut, uint256 fee, uint256 tax)",
]);
export const ponsV2FactoryAbi = parseAbi([
  "function getLaunchedToken(address token) view returns ((address token, address curve, address deployer, address creatorFeeRecipient, address pairToken, uint256 graduationThreshold, uint24 poolFee, int24 tickSpacing, uint16 creatorTaxBps, bool buybackEnabled, uint8 phase, uint256 sweptQuote, uint256 sweptTokens, uint256 sweptAt, bool exists))",
  "event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)",
]);
export const poolAbi = parseAbi([
  "function token0() view returns (address)", "function token1() view returns (address)", "function factory() view returns (address)", "function fee() view returns (uint24)",
]);
export const factoryAbi = parseAbi([
  "function getPool(address token0, address token1, uint24 fee) view returns (address)",
  "function getPair(address token0, address token1) view returns (address)",
]);
