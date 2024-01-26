// ES Modules imports
import mysql from 'mysql2/promise';
import sentry from '@sentry/serverless';
import { ProfilingIntegration } from '@sentry/profiling-node';
import { config } from 'dotenv';
config();
// Sentry setup
sentry.AWSLambda.init({
  dsn: process.env.SENTRY_DSN,
  integrations: [new ProfilingIntegration()],
  tracesSampleRate: 1.0,
  profilesSampleRate: 1.0,
});

// Function to connect to RDS
// async function connectToRDS(callerId) {
//   const config = {
//     host: process.env.DB_HOST,
//     user: process.env.DB_USER,
//     password: process.env.DB_PASSWORD,
//     database: process.env.DB_DATABASE,
//   };
//   const connection = await mysql.createConnection(config);
//   return connection;
// }

// Function to connect to RDS
async function connectToFriendlyDB(friendlyName) {
  // Replace hyphens with underscores in the friendlyName
  const sanitizedFriendlyName = friendlyName.replace(/-/g, '_');
  
  const config = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: sanitizedFriendlyName,
  };
  
  console.log("Connecting to DB with config");
  return await mysql.createConnection(config);
}

async function connectToRDS() {
  const config = {
    host: process.env.DB_RDS_HOST,
    user: process.env.DB_RDS_USER,
    password: process.env.DB_RDS_PASSWORD,
    database: process.env.DB_RDS_DATABASE,
  };
  return await mysql.createConnection(config);
}

// Function to execute query
async function executeQuery(connection, phone) {
  
  // SQL query to find leads based on phone or mobile number
  const query = `
      SELECT l.id, l.company_phone, l.mobile, l.phone, l.firstname, l.lastname, l.company
      FROM leads AS l
      WHERE l.phone LIKE ?
         OR l.mobile LIKE ?
         OR l.company_phone LIKE ?
  `;
  // Parameters for the query, using the provided phone number
  const queryParams = [`%${phone}%`, `%${phone}%`, `%${phone}%`];
  // Execute the query
  console.log("Executing query");
  const [rows] = await connection.execute(query, queryParams);
  console.log("Query executed");
  console.log(rows.length);
  // Check if any rows are returned from the query
  if (rows.length === 0) {
    // No matches found
    return {id: null, isMultiple: false};
  } else {
    // At least one match found
    // Determine if there are multiple matches
    const isMultiple = rows.length > 1;
    // Return the ID of the first row and the multiple match status
    return {id: rows[0].id, isMultiple, company: isMultiple ? rows[0].company : null};
  }
}


/**
 *
 * Event doc: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html#api-gateway-simple-proxy-for-lambda-input-format
 * @param {Object} event - API Gateway Lambda Proxy Input Format
 *
 * Context doc: https://docs.aws.amazon.com/lambda/latest/dg/nodejs-prog-model-context.html
 * @param {Object} context
 *
 * Return doc: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html
 * @returns {Object} object - API Gateway Lambda Proxy Output Format
 *
 */
export const lambdaHandler = sentry.AWSLambda.wrapHandler(async (event) => {
  try {
    console.log("Change deployed with SAM Accelerate")
    
    const {phone, friendlyName} = event.queryStringParameters;
    
    let theBaseURL = `https://${friendlyName}.engage.cience.com`;
    
    // const connectionToRDS = await connectToRDS();
    const connection = await connectToFriendlyDB(friendlyName);
    const {id: contactId, isMultiple, company} = await executeQuery(connection, phone);
    
    if (!contactId) {
      return {
        statusCode: 404,
        headers: {"Content-Type": 'application/json'},
        isBase64Encoded: false,
        body: {status: 'The caller was not found'}
      }
    }
    
    let redirectUrl;
    if (isMultiple) {
      redirectUrl = `${theBaseURL}/s/companies?search=${company}`;
    }
    
    if (contactId && !isMultiple) {
      redirectUrl = `${theBaseURL}/s/contacts/view/${contactId}`;
    }
    
    console.log("Redirecting to " + redirectUrl);
    return {
      statusCode: 302,
      headers: {"Location": redirectUrl},
      isBase64Encoded: false,
      body: ""
    };
  } catch (error) {
    console.error(`Error processing request: ${error.message}`);
    return {
      statusCode: 500,
      body: JSON.stringify({error: error.message}),
      headers: {'Content-Type': 'application/json'},
    };
  }
})
