// Mock for react-native-reanimated in Jest environment
// Prevents the react-native-worklets/plugin Babel error
const Reanimated = require('react-native-reanimated/mock');
module.exports = Reanimated;
