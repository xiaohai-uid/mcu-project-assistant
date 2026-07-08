const jwt = require('jsonwebtoken');
console.log('ENV JWT_SECRET:', process.env.JWT_SECRET);
const token = process.argv[1];
try {
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  console.log('TOKEN VALID:', JSON.stringify(decoded));
} catch(e) {
  console.log('TOKEN INVALID:', e.message);
}
